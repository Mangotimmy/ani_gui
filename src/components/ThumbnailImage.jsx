import React, { useState, useEffect, useRef } from 'react';
import { getThumbnailSources } from '../utils/image.js';

/**
 * ThumbnailImage - High-performance progressive image component
 * Implements Facebook's Progressive Image Rendering Algorithm (LQIP Blur-Up):
 * 1. Displays an instant Gaussian-blurred low-resolution placeholder silhouette.
 * 2. Negotiates modern multi-format sources (<picture> with AVIF, WebP, and JPG).
 * 3. Smoothly cross-fades & unblurs into the crisp high-resolution image upon decode.
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
  onLoad,
  onError,
  ...props
}) {
  const sources = getThumbnailSources(src);
  const primarySrc = sources.jpg || sources.fallback || (typeof src === 'string' ? src : '');
  const [isLoaded, setIsLoaded] = useState(false);
  const imgRef = useRef(null);

  useEffect(() => {
    const imgEl = imgRef.current;
    if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
      setIsLoaded(true);
    } else {
      setIsLoaded(false);
    }
  }, [primarySrc]);

  const handleLoad = (e) => {
    setIsLoaded(true);
    if (onLoad) onLoad(e);
  };

  return (
    <picture
      className={`isolate relative block overflow-hidden ${className}`.trim()}
      style={
        !isLoaded && sources.placeholder
          ? {
              backgroundImage: `url("${sources.placeholder}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }
          : undefined
      }
    >
      {/* Facebook LQIP Gaussian Blur-Up Backdrop Layer */}
      {!isLoaded && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 bg-zinc-900/50 backdrop-blur-md transition-opacity duration-300"
        />
      )}
      {sources.avif && <source type="image/avif" srcSet={sources.avif} />}
      {sources.webp && <source type="image/webp" srcSet={sources.webp} />}
      <img
        ref={imgRef}
        src={primarySrc}
        alt={alt}
        width={width}
        height={height}
        loading={loading}
        decoding={decoding}
        style={{
          ...style,
          filter: isLoaded ? 'blur(0px)' : 'blur(10px)',
          transform: isLoaded ? 'scale(1)' : 'scale(1.04)',
          opacity: isLoaded ? 1 : 0.78,
          transition: 'filter 280ms cubic-bezier(0.22, 1, 0.36, 1), transform 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease-out'
        }}
        onLoad={handleLoad}
        onError={onError}
        className={`relative z-[1] ${imgClassName || className}`.trim()}
        {...props}
      />
    </picture>
  );
}

export default ThumbnailImage;
