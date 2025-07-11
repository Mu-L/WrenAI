import functools
import logging
import os
import re
from pathlib import Path

import requests
from dotenv import load_dotenv
from langfuse.decorators import langfuse_context

from src.config import Settings

logger = logging.getLogger("wren-ai-service")


class CustomFormatter(logging.Formatter):
    def __init__(self, is_dev: bool):
        super().__init__()

        try:
            if not is_dev:
                # Imports the Cloud Logging client library
                import google.cloud.logging

                # Instantiates a client
                client = google.cloud.logging.Client()

                # Retrieves a Cloud Logging handler based on the environment
                # you're running in and integrates the handler with the
                # Python logging module. By default this captures all logs
                # at INFO level and higher
                client.setup_logging()
        except Exception:
            pass

    def format(self, record):
        _LOGGING_FORMAT = "{levelname:<.1}{asctime}.{msecs:03.0f} {process} {name}:{lineno}] {message}"
        _DATE_FMT = "%m%d %H:%M:%S"

        formatter = logging.Formatter(
            fmt=_LOGGING_FORMAT,
            datefmt=_DATE_FMT,
            style="{",
        )
        return formatter.format(record)


def setup_custom_logger(name, level_str: str, is_dev: bool):
    level_str = level_str.upper()

    if level_str not in logging._nameToLevel:
        raise ValueError(f"Invalid logging level: {level_str}")

    level = logging._nameToLevel[level_str]

    handler = logging.StreamHandler()
    handler.setFormatter(CustomFormatter(is_dev))

    logger = logging.getLogger(name)
    logger.setLevel(level)
    logger.addHandler(handler)
    return logger


def load_env_vars() -> str:
    # DEPRECATED: This method is deprecated and will be removed in the future
    if Path(".env.dev").exists():
        load_dotenv(".env.dev", override=True)
        return "dev"

    return "prod"


def remove_trailing_slash(endpoint: str) -> str:
    return endpoint.rstrip("/") if endpoint.endswith("/") else endpoint


def init_langfuse(settings: Settings):
    langfuse_context.configure(
        enabled=settings.langfuse_enable,
        host=settings.langfuse_host,
        public_key=os.getenv("LANGFUSE_PUBLIC_KEY"),
        secret_key=os.getenv("LANGFUSE_SECRET_KEY"),
    )

    logger.info(f"LANGFUSE_ENABLE: {settings.langfuse_enable}")
    logger.info(f"LANGFUSE_HOST: {settings.langfuse_host}")


def trace_metadata(func):
    """
    This decorator is used to add metadata to the current Langfuse trace.
    It should be applied after creating a trace. Here’s an example of how to use it:

    ```python
    @observe(name="Mock")
    @trace_metadata
    async def mock():
        return "Mock"
    ```

    Args:
        func (Callable): the function to decorate

    Returns:
        Callable: the decorated function
    """

    def extract(*args) -> dict:
        request = args[1]  # fix the position of the request object
        metadata = {}

        if hasattr(request, "project_id"):
            metadata["project_id"] = request.project_id
        if hasattr(request, "thread_id"):
            metadata["thread_id"] = request.thread_id
        if hasattr(request, "mdl_hash"):
            metadata["mdl_hash"] = request.mdl_hash
        if hasattr(request, "user_id"):
            metadata["user_id"] = request.user_id
        if hasattr(request, "query"):
            metadata["query"] = request.query

        return metadata

    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        trace_id = langfuse_context.get_current_trace_id()

        results = await func(*args, **kwargs, trace_id=trace_id)

        addition = {}
        if isinstance(results, dict):
            additional_metadata = results.get("metadata", {})
            addition.update(additional_metadata)

        metadata = extract(*args)
        service_metadata = kwargs.get(
            "service_metadata",
            {
                "pipes_metadata": {},
                "service_version": "",
            },
        )
        langfuse_metadata = {
            **service_metadata.get("pipes_metadata"),
            **addition,
            "mdl_hash": metadata.get("mdl_hash"),
            "project_id": metadata.get("project_id"),
            "query": metadata.get("query"),
        }
        langfuse_context.update_current_trace(
            user_id=metadata.get("user_id"),
            session_id=metadata.get("thread_id"),
            release=service_metadata.get("service_version"),
            metadata=langfuse_metadata,
        )

        return results

    return wrapper


def trace_cost(func):
    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        result, generator_name = await func(*args, **kwargs)

        if isinstance(result, dict):
            if meta := result.get("meta", []):
                model = meta[0].get("model")
                langfuse_context.update_current_observation(
                    model=model,
                    usage_details=meta[0].get("usage", {}),
                )
                langfuse_context.update_current_trace(
                    metadata={"fallback_is_triggered": model != generator_name}
                )

        return result

    return wrapper


def fetch_wren_ai_docs(doc_endpoint: str, is_oss: bool) -> list[dict]:
    doc_endpoint = remove_trailing_slash(doc_endpoint)
    api_endpoint = (
        f"{doc_endpoint}/oss/llms.md" if is_oss else f"{doc_endpoint}/cloud/llms.md"
    )

    try:
        response = requests.get(api_endpoint, timeout=10)
        response.raise_for_status()  # Raise exception for 4XX/5XX responses
        docs = response.text.split("\n---\n")
    except requests.RequestException as e:
        logger.error(f"Failed to fetch Wren AI docs: {str(e)}")
        return []  # Return empty list on error

    doc_endpoint_base = f"{doc_endpoint}/oss" if is_oss else f"{doc_endpoint}/cloud"
    results = []
    for doc in docs:
        if doc:
            path, content = doc.split("\n")
            results.append(
                {
                    "path": f'{doc_endpoint_base}/{path.replace(".md", "")}',
                    "content": content,
                }
            )

    return results


def extract_braces_content(resp: str) -> str:
    """
    Extracts JSON content enclosed in a markdown code block that starts with ```json.
    Returns the JSON string including braces, or the original string if no match is found.
    """
    match = re.search(r"```json\s*(\{.*?\})\s*```", resp, re.DOTALL)
    return match.group(1) if match else resp
