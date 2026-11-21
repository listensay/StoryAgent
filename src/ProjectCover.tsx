import { Center, Image } from '@mantine/core';
import { useEffect, useState } from 'react';
import { BookOpen } from './icons';

export function ProjectCover({ source, title, width = 180, height = 270 }: { source: string; title: string; width?: number; height?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  return <Center w={width} h={height} bg="gray.1" style={{ flexShrink: 0, borderRadius: 8, overflow: 'hidden' }}>
    {source && !failed ? <Image src={source} alt={`${title}封面`} w={width} h={height} fit="contain" onError={() => setFailed(true)} /> : <BookOpen size={36} aria-hidden="true" />}
  </Center>;
}
