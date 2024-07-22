import { useMemo } from 'react';
import clsx from 'clsx';
import { Tag } from 'antd';
import { groupBy } from 'lodash';
import styled from 'styled-components';
import { getReferenceIcon, Reference } from './utils';
import env from '@/utils/env';

const SQLWrapper = styled.div`
  position: absolute;
  top: 0;
  left: 28px;
  right: 0;
  z-index: 1;
  font-size: 14px;
  margin: 0 3px;
  overflow: hidden;
  color: transparent;

  mark {
    cursor: pointer;
    position: relative;
    color: transparent;
    background-color: rgba(250, 219, 20, 0.2);
    padding: 2px 0;
  }

  .ant-tag {
    margin-right: 4px;
  }

  .tag-wrap {
    position: absolute;
    left: 100%;
    top: -16px;
  }
`;

interface Props {
  sql: string;
  references: Reference[];
}

const optimizedSnippet = (snippet: string) => {
  // SQL analysis may add more spaces and add brackets to the sql, so we need to handle it.
  return snippet
    .replace(/\(/g, '\\(?')
    .replace(/\)/g, '\\)?')
    .replace(/\s/g, '\\s*');
};

const createSnippetsRegex = (snippets: string[]) => {
  return new RegExp(`(${snippets.join('|')})`, 'gi');
};

const printUnmatchedReferences = (
  references: Reference[],
  referenceMatches,
) => {
  // For debugging purpose
  const unmatchedReferences = references.filter(
    (reference) => !referenceMatches.flat().includes(reference),
  );
  if (unmatchedReferences.length > 0)
    console.warn('Unmatched references:', unmatchedReferences);
};

export default function SQLHighlight(props: Props) {
  const { sql, references } = props;

  const sqlArray = useMemo(() => sql.split('\n'), [sql]);
  const referenceGroups = useMemo(() => {
    const filteredReferences = references.filter(
      (reference) => reference.sqlLocation,
    );
    return groupBy(
      filteredReferences,
      (reference) => reference.sqlLocation.line,
    );
  }, [references]);

  const highlights = [];
  const referenceMatches = [];
  Object.keys(referenceGroups).forEach((line) => {
    const lineIndex = Number(line) - 1;
    const lineReferences = referenceGroups[line];
    const snippets = lineReferences.map((r) => optimizedSnippet(r.sqlSnippet));
    const regex = createSnippetsRegex(snippets);
    const parts = sqlArray[lineIndex].split(regex);

    // Add to highlights if the part is matched
    highlights[lineIndex] = parts.map((part, index) => {
      if (regex.test(part)) {
        const matchedReferences = lineReferences.filter((reference) =>
          new RegExp(reference.sqlSnippet).test(part),
        );
        const tags = matchedReferences.map((reference) => {
          return (
            <Tag
              className={clsx('ant-tag__reference')}
              key={reference.referenceNum}
            >
              <span className="mr-1 lh-xs">
                {getReferenceIcon(reference.type)}
              </span>
              {reference.referenceNum}
            </Tag>
          );
        });
        // Record the matched references
        referenceMatches.push(matchedReferences);

        return (
          <mark key={index}>
            {part}
            {tags && <span className="tag-wrap">{tags}</span>}
          </mark>
        );
      }
      return <span key={index}>{part}</span>;
    });
  });

  const content = sqlArray.map((line, index) => (
    <div key={index}>{highlights[index] || line}</div>
  ));

  // For debugging purpose
  if (env.isDevelopment) {
    printUnmatchedReferences(references, referenceMatches);
  }

  return <SQLWrapper>{content}</SQLWrapper>;
}
