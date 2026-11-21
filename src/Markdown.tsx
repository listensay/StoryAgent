import { memo } from 'react';
import { Anchor, Box, Checkbox, Typography, UnstyledButton } from '@mantine/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type { Root, RootContent } from 'mdast';
import classes from './Markdown.module.css';

// CommonMark leaves Chinese labels such as **视角：**陆昭 unparsed when the
// closing punctuation touches a letter. Only recover these plain-text labels;
// escaped source, code, links and other parsed nodes keep their original meaning.
function remarkChineseLabels() {
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value);
    const visit = (node: Root | RootContent) => {
      if (!('children' in node) || node.type === 'link' || node.type === 'linkReference') return;
      const children = node.children as RootContent[];
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        if (child.type !== 'text') { visit(child); continue; }
        if (child.position?.start.offset === undefined || child.position.end.offset === undefined || source.slice(child.position.start.offset, child.position.end.offset) !== child.value) continue;
        const parts: RootContent[] = [];
        let offset = 0;
        for (const match of child.value.matchAll(/\*\*([^*\n]*\p{Script=Han}[^*\n]*[\p{P}\p{S}])\*\*(?=[\p{L}\p{N}])/gu)) {
          if (match.index > offset) parts.push({ type: 'text', value: child.value.slice(offset, match.index) });
          parts.push({ type: 'strong', children: [{ type: 'text', value: match[1] }] });
          offset = match.index + match[0].length;
        }
        if (!parts.length) continue;
        if (offset < child.value.length) parts.push({ type: 'text', value: child.value.slice(offset) });
        children.splice(index, 1, ...parts); index += parts.length - 1;
      }
    };
    visit(tree);
  };
}

// Convert citations after parsing so code and existing links keep their meaning.
function remarkCitations() {
  return (tree: Root) => {
    const visit = (node: Root | RootContent) => {
      if (!('children' in node) || node.type === 'link' || node.type === 'linkReference') return;
      const children = node.children as RootContent[];
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        if (child.type !== 'text') { visit(child); continue; }
        const parts: RootContent[] = [];
        let offset = 0;
        for (const match of child.value.matchAll(/\[P([1-9]\d*)\]/g)) {
          if (!Number.isSafeInteger(Number(match[1]))) continue;
          if (match.index > offset) parts.push({ type: 'text', value: child.value.slice(offset, match.index) });
          parts.push({ type: 'link', url: `#source-p-${match[1]}`, children: [{ type: 'text', value: match[0] }], data: { hProperties: { 'data-source-paragraph': match[1] } } });
          offset = match.index + match[0].length;
        }
        if (!parts.length) continue;
        if (offset < child.value.length) parts.push({ type: 'text', value: child.value.slice(offset) });
        children.splice(index, 1, ...parts);
        index += parts.length - 1;
      }
    };
    visit(tree);
  };
}

export const Markdown = memo(function Markdown({ children, className = '', size = 'sm', onCitation, onError }: { children: string; className?: string; size?: 'sm' | 'md'; onCitation?: (paragraph: number) => void; onError: (message: string) => void }) {
  return <Typography className={`${classes.root} ${className}`} fz={size} lh={size === 'md' ? 1.95 : 1.8} style={{ overflowWrap: 'anywhere', minWidth: 0 }}>
    <ReactMarkdown skipHtml remarkPlugins={[remarkGfm, remarkBreaks, remarkChineseLabels, ...(onCitation ? [remarkCitations] : [])]} components={{
      a: ({ children: label, href, node }) => {
        const paragraph = Number(node?.properties['data-source-paragraph']);
        if (onCitation && Number.isSafeInteger(paragraph) && paragraph > 0) return <UnstyledButton aria-label={`查看原文第 ${paragraph} 段`} c="story.9" bg="story.1" px={4} fz="inherit" lh="inherit" style={{ display: 'inline', borderRadius: 4, verticalAlign: 'baseline' }} onClick={() => onCitation(paragraph)}>{label}</UnstyledButton>;
        if (!href || !/^https?:\/\//i.test(href)) return <>{label}</>;
        return <Anchor href={href} size="inherit" onClick={event => { event.preventDefault(); void openUrl(href).catch(() => onError('链接打开失败')); }}>{label}</Anchor>;
      },
      table: ({ children: rows }) => <Box maw="100%" style={{ overflowX: 'auto' }}><Box component="table" miw={360}>{rows}</Box></Box>,
      input: ({ checked }) => <Checkbox checked={!!checked} readOnly disabled aria-label={checked ? '已完成' : '未完成'} display="inline-block" mr="xs" />,
      img: ({ alt }) => <>{alt}</>,
    }}>{children}</ReactMarkdown>
  </Typography>;
});
