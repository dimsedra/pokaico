import React, { useRef, useEffect } from 'react';
import {
  ProceduralSpriteTemplate,
  ExpressionType,
  CustomizationOptions,
  Particle
} from '../types';

interface ProceduralSpriteCanvasProps {
  template: ProceduralSpriteTemplate;
  expression: ExpressionType;
  options?: CustomizationOptions;
  size?: number;
  className?: string;
  isPaused?: boolean;
}

export const ProceduralSpriteCanvas: React.FC<ProceduralSpriteCanvasProps> = ({
  template,
  expression,
  options: userOptions,
  size = 240,
  className = '',
  isPaused = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const lastStateRef = useRef<ExpressionType>(expression);
  const transitionProgressRef = useRef<number>(1.0);

  const activeOptions: CustomizationOptions = {
    ...template.defaultOptions,
    ...userOptions,
  };

  const resolution = template.resolution || 64;
  const pivotX = template.pivotX || 32;
  const pivotY = template.pivotY || 54;

  useEffect(() => {
    if (expression !== lastStateRef.current) {
      lastStateRef.current = expression;
      transitionProgressRef.current = 0;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const offscreen = document.createElement('canvas');
    offscreen.width = resolution;
    offscreen.height = resolution;
    const oCtx = offscreen.getContext('2d');
    if (!oCtx) return;

    let animId: number;

    const render = () => {
      if (!isPaused) {
        timeRef.current += 1 * (activeOptions.animationSpeed || 1.0);
      }

      const t = timeRef.current;

      if (transitionProgressRef.current < 1.0) {
        transitionProgressRef.current += 0.08;
        if (transitionProgressRef.current > 1.0) transitionProgressRef.current = 1.0;
      }

      oCtx.clearRect(0, 0, resolution, resolution);

      const grid: (string | null)[][] = Array(resolution)
        .fill(null)
        .map(() => Array(resolution).fill(null));

      const deform = template.getDeformation(expression, t);
      const bounceTransition = Math.sin(transitionProgressRef.current * Math.PI) * 1.5;
      const offsetY = deform.offsetY - bounceTransition * 1.2;

      const basePixels = template.getBasePixels(activeOptions);
      const palette = template.getPalette(activeOptions);

      // Pivot offset buffer for smooth transformations
      const baseGrid: (string | null)[][] = Array(120).fill(null).map(() => Array(100).fill(null));
      basePixels.forEach((p) => {
        const gridX = p.rx + 40;
        const gridY = p.ry + 60;
        if (gridX >= 0 && gridX < 100 && gridY >= 0 && gridY < 120) {
          baseGrid[gridY][gridX] = p.type;
        }
      });

      // Backward map from target pixels to source pixels
      for (let ty = 0; ty < resolution; ty++) {
        const rty = ty - pivotY - offsetY;
        const ryFloat = rty / deform.scaleY;
        const ry = Math.round(ryFloat);
        const gridY = ry + 60;

        if (gridY >= 0 && gridY < 120) {
          for (let tx = 0; tx < resolution; tx++) {
            const rtx = tx - pivotX - deform.offsetX;

            let tiltOffset = 0;
            if (deform.rotation !== 0) {
              const heightFactor = Math.abs(ryFloat) / 42;
              tiltOffset = deform.rotation * heightFactor;
            }

            const rxFloat = (rtx - tiltOffset) / deform.scaleX;
            const rx = Math.round(rxFloat);
            const gridX = rx + 40;

            if (gridX >= 0 && gridX < 100) {
              const type = baseGrid[gridY][gridX];
              if (type) {
                grid[ty][tx] = palette[type] || '#ffffff';
              }
            }
          }
        }
      }

      // Draw face overlay if provided by template
      if (template.drawFace) {
        template.drawFace(oCtx, expression, t, pivotX, pivotY, 1, activeOptions);
      }

      // Render body pixels to offscreen context
      for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
          const color = grid[y][x];
          if (color) {
            oCtx.fillStyle = color;
            oCtx.fillRect(x, y, 1, 1);
          }
        }
      }

      // Draw pixel art outline if enabled
      if (activeOptions.enableOutline !== false) {
        const outlineColor = activeOptions.outlineColor || '#26233a';
        oCtx.fillStyle = outlineColor;

        for (let y = 0; y < resolution; y++) {
          for (let x = 0; x < resolution; x++) {
            if (!grid[y][x]) {
              const hasNeighbor =
                (y > 0 && grid[y - 1][x]) ||
                (y < resolution - 1 && grid[y + 1][x]) ||
                (x > 0 && grid[y][x - 1]) ||
                (x < resolution - 1 && grid[y][x + 1]);

              if (hasNeighbor) {
                oCtx.fillRect(x, y, 1, 1);
              }
            }
          }
        }
      }

      // Handle particles
      if (template.getParticles && !isPaused) {
        const newParticles = template.getParticles(expression, t, pivotX, pivotY);
        particlesRef.current.push(...newParticles);
      }

      particlesRef.current.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life += 1;
        p.alpha = 1.0 - p.life / p.maxLife;

        if (p.alpha > 0) {
          oCtx.fillStyle = p.color;
          oCtx.globalAlpha = p.alpha;
          oCtx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
          oCtx.globalAlpha = 1.0;
        }
      });

      particlesRef.current = particlesRef.current.filter((p) => p.life < p.maxLife);

      // Render to main display canvas with pixelated scaling
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [template, expression, JSON.stringify(activeOptions), isPaused]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={`inline-block select-none ${className}`}
      style={{ imageRendering: 'pixelated' }}
    />
  );
};
