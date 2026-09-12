import React, { useEffect, useRef, useState } from 'react';
import { DetectedObject } from '../types';
import { getYOLODisplayName } from '../services/yoloConfig';

interface BoundingBoxOverlayProps {
  objects: DetectedObject[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  sourceWidth?: number;
  sourceHeight?: number;
  colorScheme?: 'teal' | 'emerald' | 'cyan';
}

/**
 * Accurately projects normalized [0..1] bounding boxes onto the rendered video/image element
 * accounting for object-contain letterboxing inside the container.
 */
export const BoundingBoxOverlay: React.FC<BoundingBoxOverlayProps> = ({
  objects,
  containerRef,
  sourceWidth = 640,
  sourceHeight = 480,
  colorScheme = 'teal',
}) => {
  const [contentRect, setContentRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>({ left: 0, top: 0, width: 0, height: 0 });

  const updateRect = () => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const cWidth = container.clientWidth;
    const cHeight = container.clientHeight;

    if (cWidth === 0 || cHeight === 0 || sourceWidth === 0 || sourceHeight === 0) return;

    // Calculate object-contain letterbox within the container
    const containerAspect = cWidth / cHeight;
    const sourceAspect = sourceWidth / sourceHeight;

    let renderedW = cWidth;
    let renderedH = cHeight;
    let offsetX = 0;
    let offsetY = 0;

    if (sourceAspect > containerAspect) {
      // Fit to width, bars on top/bottom
      renderedW = cWidth;
      renderedH = cWidth / sourceAspect;
      offsetY = (cHeight - renderedH) / 2;
    } else {
      // Fit to height, bars on left/right
      renderedH = cHeight;
      renderedW = cHeight * sourceAspect;
      offsetX = (cWidth - renderedW) / 2;
    }

    setContentRect({
      left: offsetX,
      top: offsetY,
      width: renderedW,
      height: renderedH,
    });
  };

  useEffect(() => {
    updateRect();
    const handleResize = () => updateRect();
    window.addEventListener('resize', handleResize);

    const observer = new ResizeObserver(() => updateRect());
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
    };
  }, [containerRef, sourceWidth, sourceHeight]);

  if (objects.length === 0 || contentRect.width === 0) {
    return null;
  }

  const borderColors = {
    teal: 'border-teal-400 bg-teal-400/15',
    emerald: 'border-emerald-400 bg-emerald-400/15',
    cyan: 'border-cyan-400 bg-cyan-400/15',
  };

  const badgeColors = {
    teal: 'bg-[#005f60] text-white',
    emerald: 'bg-emerald-700 text-white',
    cyan: 'bg-cyan-700 text-white',
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: `${contentRect.left}px`,
        top: `${contentRect.top}px`,
        width: `${contentRect.width}px`,
        height: `${contentRect.height}px`,
        pointerEvents: 'none',
      }}
      className="z-20 pointer-events-none"
    >
      {objects.map((obj) => {
        const boxLeft = obj.bbox.x * contentRect.width;
        const boxTop = obj.bbox.y * contentRect.height;
        const boxWidth = obj.bbox.width * contentRect.width;
        const boxHeight = obj.bbox.height * contentRect.height;

        return (
          <div
            key={obj.id}
            style={{
              position: 'absolute',
              left: `${boxLeft}px`,
              top: `${boxTop}px`,
              width: `${boxWidth}px`,
              height: `${boxHeight}px`,
            }}
            className={`border-2 ${borderColors[colorScheme]} rounded-xs transition-all duration-75 shadow-xs`}
          >
            <div
              className={`absolute top-0 left-0 -translate-y-full ${badgeColors[colorScheme]} text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-t flex items-center gap-1 shadow-xs whitespace-nowrap`}
            >
              <span>{getYOLODisplayName(obj.className)}</span>
              <span className="opacity-90">{(obj.confidence * 100).toFixed(0)}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
