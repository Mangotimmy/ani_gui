import React from 'react';
import { getThumbnailSources } from '../utils/image.js';

/**
 * ThumbnailImage - High-performance responsive image component
 * Renders modern <picture> markup with AVIF, WebP, and JPG fallback formats.
 */
export function ThumbnailImage({
  src,
  alt = '',
  className = '',
  imgClassName = '',
  loading = 'lazy',
  decoding = 'async',
  width,
  height,
  style,
  onError,
  ...props
}) {
  const sources = getThumbnailSources(src);

  return (
    <picture className={className}>
      {sources.avif && <source type="image/avif" srcSet={sources.avif} />}
      {sources.webp && <source type="image/webp" srcSet={sources.webp} />}
      <img
        src={sources.jpg || sources.fallback || src}
        alt={alt}
        width={width}
        height={height}
        loading={loading}
        decoding={decoding}
        style={style}
        onError={onError}
        className={imgClassName || className}
        {...props}
      />
    </picture>
  );
}

export default ThumbnailImage;
