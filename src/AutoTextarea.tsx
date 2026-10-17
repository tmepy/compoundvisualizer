import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

export default function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = () => {
      element.style.height = '0px';
      const max = parseFloat(getComputedStyle(element).maxHeight) || 320;
      const height = Math.min(element.scrollHeight + 2, max);
      element.style.height = `${height}px`;
      element.style.overflowY = element.scrollHeight > max ? 'auto' : 'hidden';
    };
    resize();
    // Reflow when a responsive layout changes the available width.
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => { if (element.clientWidth !== width) { width = element.clientWidth; resize(); } });
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.value]);
  return <textarea {...props} ref={ref}/>;
}
