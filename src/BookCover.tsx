import { useEffect, useState } from 'react';
import { Center, Image } from '@mantine/core';
import { useIntersection } from '@mantine/hooks';
import { invoke } from '@tauri-apps/api/core';
import { BookOpen } from './icons';
import type { RankedBook } from './rankings';

const covers = new Map<string, Promise<Blob>>();
type CoverBook = Pick<RankedBook, 'url' | 'title' | 'coverUrl'>;
function loadCover(book: CoverBook) {
  const key = book.url;
  let pending = covers.get(key);
  if (!pending) {
    pending = invoke<{ bytes: number[]; mime: string }>('ranking_cover', { bookUrl: key, coverUrl: book.coverUrl ?? null })
      .then(result => new Blob([new Uint8Array(result.bytes)], { type: result.mime }))
      .catch(error => { covers.delete(key); throw error; });
    if (covers.size >= 64) covers.delete(covers.keys().next().value!);
    covers.set(key, pending);
  }
  return pending;
}

export function BookCover({ book }: { book: CoverBook }) {
  const { ref, entry } = useIntersection<HTMLDivElement>({ threshold: 0 });
  const [source, setSource] = useState('');
  const [visible, setVisible] = useState(false);
  useEffect(() => { if (entry?.isIntersecting) setVisible(true); }, [entry?.isIntersecting]);
  useEffect(() => {
    if (!visible) return;
    let active = true, objectUrl = '';
    setSource('');
    void loadCover(book).then(blob => {
      if (active) { objectUrl = URL.createObjectURL(blob); setSource(objectUrl); }
    }).catch(() => {});
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [visible, book.url, book.coverUrl]);
  return <Center ref={ref} w={60} h={80} bg="gray.1" style={{ flexShrink: 0, borderRadius: 6, overflow: 'hidden' }}>
    {source ? <Image src={source} alt={`${book.title}封面`} w={60} h={80} fit="cover" onError={() => setSource('')} /> : <BookOpen size={24} aria-hidden="true" />}
  </Center>;
}
