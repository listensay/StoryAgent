import { useCallback, useLayoutEffect, useState } from 'react';

export function useAIScroll(follow = true) {
  const [content, setContent] = useState<HTMLElement | null>(null);
  const [request, setRequest] = useState(0);
  const scrollToBottom = useCallback(() => setRequest(value => value + 1), []);

  useLayoutEffect(() => {
    if (!content || !request) return;
    let viewport: HTMLElement | null = content;
    while (viewport && !/^(auto|scroll)$/.test(getComputedStyle(viewport).overflowY)) viewport = viewport.parentElement;
    if (!viewport) return;
    const scroller = viewport;
    let following = true;
    let frame = 0;
    let height = scroller.scrollHeight;
    const scroll = () => {
      height = scroller.scrollHeight;
      scroller.scrollTo({ top: height, behavior: 'instant' });
    };
    scroll();
    if (!follow) return;
    const schedule = () => {
      if (!following || frame) return;
      frame = requestAnimationFrame(() => { frame = 0; if (following) scroll(); });
    };
    const onScroll = () => {
      // Content growth can emit a scroll event before the next layout frame.
      if (height === scroller.scrollHeight) following = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 48;
      height = scroller.scrollHeight;
    };
    const mutations = new MutationObserver(schedule);
    const resize = new ResizeObserver(schedule);
    mutations.observe(content, { childList: true, characterData: true, subtree: true });
    resize.observe(content);
    resize.observe(scroller);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
      scroller.removeEventListener('scroll', onScroll);
    };
  }, [content, request, follow]);

  return { contentRef: setContent, scrollToBottom };
}
