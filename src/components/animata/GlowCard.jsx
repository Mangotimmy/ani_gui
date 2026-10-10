// src/components/animata/GlowCard.jsx
// Hand-crafted Spotlight / Glow Card inspired by Animata (https://github.com/codse/animata)
// Provides interactive radial cursor spotlight, layered elevation shadows, and tactile 0.96 press scaling.

import React, { useState, useRef, useCallback } from 'react';

export default function GlowCard({
  children,
  className = '',
  spotlightColor = 'rgba(229, 9, 20, 0.16)',
  borderColor = 'rgba(229, 9, 20, 0.35)',
  radius = 'rounded-2xl',
  onClick,
  interactive = true,
  scaleOnPress = false,
  as: Component = 'div',
  ...props
}) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const cardRef = useRef(null);

  const handleMouseMove = useCallback((e) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    setPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
  }, []);

  return (
    <Component
      ref={cardRef}
      onClick={onClick}
      onMouseMove={interactive ? handleMouseMove : undefined}
      onMouseEnter={interactive ? () => setIsHovered(true) : undefined}
      onMouseLeave={interactive ? () => setIsHovered(false) : undefined}
      className={`relative overflow-hidden bg-zinc-900/80 border border-zinc-800/90 shadow-lg ${radius} ${
        scaleOnPress ? 'motion-safe:active:scale-[0.96] transition-transform duration-150 ease-out' : ''
      } ${className}`}
      {...props}
    >
      {/* Animata Cursor Spotlight Radial Glow */}
      {interactive && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-px transition-opacity duration-300 motion-reduce:hidden"
          style={{
            opacity: isHovered ? 1 : 0,
            background: `radial-gradient(400px circle at ${pos.x}px ${pos.y}px, ${spotlightColor}, transparent 80%)`,
            zIndex: 1
          }}
        />
      )}

      {/* Subtle border glow layer on hover */}
      {interactive && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-px transition-opacity duration-300 motion-reduce:hidden"
          style={{
            opacity: isHovered ? 1 : 0,
            border: `1px solid ${borderColor}`,
            borderRadius: 'inherit',
            zIndex: 2
          }}
        />
      )}

      {/* Card Content */}
      <div className="relative z-10 w-full h-full">
        {children}
      </div>
    </Component>
  );
}
