import clsx from 'clsx';
import { Tag } from 'antd';
import { groupBy } from 'lodash';
import styled from 'styled-components';
import { getReferenceIcon } from './utils';

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

const optimizedSnippet = (snippet: string) => {
  // SQL analysis may add more spaces and add brackets to the sql, so we need to handle it.
  return snippet
    .replace(/\(/g, '\\(?')
    .replace(/\)/g, '\\)?')
    .replace(/\s/g, '\\s*');
};

export default function SQLHighlight(props) {
  const { sql, references } = props;

  const sqlArray = sql.split('\n');
  const referenceGroups = groupBy(
    references,
    (reference) => reference.sqlLocation.line,
  );

  const result = [...sqlArray];

  Object.keys(referenceGroups).forEach((line) => {
    const index = Number(line) - 1;
    const lineReferences = referenceGroups[line];
    const snippets = lineReferences.map((r) => optimizedSnippet(r.sqlSnippet));
    const regex = new RegExp(`(${snippets.join('|')})`, 'gi');

    const parts = result[index].split(regex);
    console.log(`full line: [${result[index]}]`);
    console.log(`snippets: ${snippets}`, regex);
    console.log('part', parts);
    console.log('----------- divider -----------');

    result[index] = parts.map((part, partIndex) => {
      if (regex.test(part)) {
        const matchedReferences = lineReferences.filter((snippet) =>
          new RegExp(snippet).test(part),
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
        return (
          <mark key={partIndex}>
            {part}
            {tags && <span className="tag-wrap">{tags}</span>}
          </mark>
        );
      }
      return <span key={partIndex}>{part}</span>;
    });
  });

  const content = result.map((line, index) => <div key={index}>{line}</div>);

  return <SQLWrapper>{content}</SQLWrapper>;
}
