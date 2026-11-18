import React, { useState, useEffect, useRef } from 'react';
import { getThumbnailSources } from '../utils/image.js';

/**
 * ThumbnailImage - Lightweight progressive image component.
 * Uses native <picture> + loading="lazy" without eager CSS backgroundImage fetches or
 * per-card backdrop-filter layers, and renders priority LCP hero images immediately
 * at full opacity with zero blur or extra network requests.
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
  const [isLoaded, setIsLoaded] = useState(isPriority);
  const imgRef = useRef(null);

  useEffect(() => {
    if (isPriority) {
      setIsLoaded(true);
      return;
    }
    const imgEl = imgRef.current;
    if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
      setIsLoaded(true);
    } else {
      setIsLoaded(false);
    }
  }, [primarySrc, isPriority]);

  const handleLoad = (e) => {
    if (!isLoaded) setIsLoaded(true);
    if (onLoad) onLoad(e);
  };

  const handleError = (e) => {
    if (!isLoaded) setIsLoaded(true);
    if (onError) onError(e);
  };

  const imgStyle = isPriority
    ? style
    : {
        ...style,
        opacity: isLoaded ? 1 : 0,
        transition: 'opacity 180ms ease-out'
      };

  return (
    <picture className={`isolate relative block overflow-hidden ${className}`.trim()}>
      {sources.avif && <source type="image/avif" srcSet={sources.avif} />}
      {sources.webp && <source type="image/webp" srcSet={sources.webp} />}
      <img
        ref={imgRef}
        src={primarySrc}
        alt={alt}
        width={width}
        height={height}
        loading={isPriority ? 'eager' : loading}
        decoding={decoding}
        style={imgStyle}
        onLoad={handleLoad}
        onError={handleError}
        className={`relative z-[1] ${imgClassName || className}`.trim()}
        {...props}
      />
    </picture>
  );
}

export default ThumbnailImage;
