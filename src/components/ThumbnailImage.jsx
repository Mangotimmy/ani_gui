import React from 'react';
import { getThumbnailSources } from '../utils/image.js';

/**
 * ThumbnailImage - Lightweight progressive image component.
 * Uses native <picture> + loading="lazy" without eager CSS backgroundImage fetches,
 * per-card backdrop-filter layers, or opacity:0 hiding traps that can leave deferred
 * modal/grid thumbnails invisible until refresh.
 */
export function ThumbnailImage({
  src,
  alt = '',
  className = '',
  imgClassName = '',
  loading = 'lazy',
  decoding = 'async',
  priority = false,
  width,
  height,
  style,
  onLoad,
  onError,
  ...props
}) {
  const isPriority = priority || props.fetchPriority === 'high';
  const sources = getThumbnailSources(src);
  const primarySrc = sources.jpg || sources.fallback || (typeof src === 'string' ? src : '');

  return (
    <picture className={`isolate relative block overflow-hidden bg-zinc-900/60 ${className}`.trim()}>
      {sources.avif && <source type="image/avif" srcSet={sources.avif} />}
      {sources.webp && <source type="image/webp" srcSet={sources.webp} />}
      <img
        src={primarySrc}
        alt={alt}
        width={width}
        height={height}
        loading={isPriority ? 'eager' : loading}
        decoding={decoding}
        style={style}
        onLoad={onLoad}
        onError={onError}
        className={`relative z-[1] ${imgClassName || className}`.trim()}
        {...props}
      />
    </picture>
  );
}

export default ThumbnailImage;
