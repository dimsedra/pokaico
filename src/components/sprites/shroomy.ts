import {
  ProceduralSpriteTemplate,
  CustomizationOptionField,
  CustomizationOptions,
  SpritePixel,
  SpriteDeformation,
  Particle,
  ExpressionType
} from '../../types';

// Helper function to blend colors dynamically for 3D dithered shading
const blendColors = (color1: string, color2: string, weight: number): string => {
  const parse = (c: string) => {
    let clean = c.replace('#', '');
    if (clean.length === 3) {
      clean = clean.split('').map(x => x + x).join('');
    }
    const num = parseInt(clean, 16);
    return [num >> 16, (num >> 8) & 0x00ff, num & 0x0000ff];
  };

  try {
    const [r1, g1, b1] = parse(color1);
    const [r2, g2, b2] = parse(color2);

    const r = Math.round(r1 + (r2 - r1) * weight);
    const g = Math.round(g1 + (g2 - g1) * weight);
    const b = Math.round(b1 + (b2 - b1) * weight);

    const rHex = Math.min(255, Math.max(0, r)).toString(16).padStart(2, '0');
    const gHex = Math.min(255, Math.max(0, g)).toString(16).padStart(2, '0');
    const bHex = Math.min(255, Math.max(0, b)).toString(16).padStart(2, '0');

    return `#${rHex}${gHex}${bHex}`;
  } catch (e) {
    return color1;
  }
};

export const shroomyCustomizationSchema: CustomizationOptionField[] = [
  {
    id: 'capColor',
    label: 'Cap Color',
    type: 'color',
    category: 'Cap & Body',
    defaultValue: '#eb6f92',
  },
  {
    id: 'capShadowColor',
    label: 'Cap Shadow',
    type: 'color',
    category: 'Cap & Body',
    defaultValue: '#b74765',
  },
  {
    id: 'spotColor',
    label: 'Spot Color',
    type: 'color',
    category: 'Cap & Body',
    defaultValue: '#faf4ed',
  },
  {
    id: 'spotStyle',
    label: 'Spot Pattern',
    type: 'select',
    category: 'Cap & Body',
    defaultValue: 'classic',
    options: [
      { label: 'Classic Dots', value: 'classic' },
      { label: 'Twinkly Stars', value: 'stars' },
      { label: 'Minimal', value: 'minimal' },
      { label: 'No Spots', value: 'none' },
    ],
  },
  {
    id: 'stalkColor',
    label: 'Stalk Color',
    type: 'color',
    category: 'Stalk & Face',
    defaultValue: '#fffaf3',
  },
  {
    id: 'stalkShadowColor',
    label: 'Stalk Shadow',
    type: 'color',
    category: 'Stalk & Face',
    defaultValue: '#e0d8cc',
  },
  {
    id: 'blushColor',
    label: 'Blush Color',
    type: 'color',
    category: 'Stalk & Face',
    defaultValue: '#ebbcba',
  },
  {
    id: 'eyeColor',
    label: 'Eye Color',
    type: 'color',
    category: 'Stalk & Face',
    defaultValue: '#26233a',
  },
  {
    id: 'eyeStyle',
    label: 'Eye Style',
    type: 'select',
    category: 'Stalk & Face',
    defaultValue: 'bead',
    options: [
      { label: 'Classic Bead', value: 'bead' },
      { label: 'Sparkly Anime', value: 'anime' },
      { label: 'Minimal Dot', value: 'minimal' },
    ],
  },
  {
    id: 'outlineColor',
    label: 'Outline Color',
    type: 'color',
    category: 'Style & Effects',
    defaultValue: '#26233a',
  },
  {
    id: 'animationSpeed',
    label: 'Anim Speed',
    type: 'number',
    category: 'Style & Effects',
    defaultValue: 1.0,
    min: 0.2,
    max: 2.0,
    step: 0.1,
  },
];

export const shroomyDefaultOptions: CustomizationOptions = {
  capColor: '#eb6f92',
  capShadowColor: '#b74765',
  spotColor: '#faf4ed',
  spotStyle: 'classic',
  stalkColor: '#fffaf3',
  stalkShadowColor: '#e0d8cc',
  blushColor: '#ebbcba',
  eyeColor: '#26233a',
  eyeStyle: 'bead',
  outlineColor: '#26233a',
  animationSpeed: 1.0,
  enableOutline: true,
};

export const shroomyTemplate: ProceduralSpriteTemplate = {
  id: 'shroomy',
  name: 'Shroomy',
  resolution: 64,
  pivotX: 32,
  pivotY: 54,
  customizationSchema: shroomyCustomizationSchema,
  defaultOptions: shroomyDefaultOptions,

  getBasePixels: (options: CustomizationOptions): SpritePixel[] => {
    const pixels: SpritePixel[] = [];

    // 1. STALK
    for (let ry = -22; ry <= 0; ry++) {
      const isBase = ry >= -2 && ry <= 0;
      const isLowStalk = ry >= -6 && ry <= -3;
      const isSkirtWaist = ry >= -14 && ry <= -11;

      let minRx = -7;
      let maxRx = 6;

      if (isBase) {
        minRx = -11;
        maxRx = 10;
      } else if (isLowStalk) {
        minRx = -9;
        maxRx = 8;
      } else if (isSkirtWaist) {
        minRx = -8;
        maxRx = 7;
      } else if (ry >= -10 && ry <= -7) {
        minRx = -7;
        maxRx = 6;
      } else {
        minRx = -7;
        maxRx = 6;
      }

      for (let rx = minRx; rx <= maxRx; rx++) {
        let type = 'stalk';
        if (ry === 0) {
          type = 'stalk_shadow';
        } else if (ry === -14) {
          type = 'stalk_skirt_shadow';
        } else if (rx === minRx || rx === minRx + 1) {
          type = 'stalk_shadow';
        } else if (rx === minRx + 2 || rx === minRx + 3) {
          type = 'stalk_shade_left';
        } else if (rx === maxRx) {
          type = 'stalk_highlight';
        } else if (rx === maxRx - 1) {
          type = 'stalk_highlight_minor';
        }
        pixels.push({ rx, ry, type });
      }
    }

    // 2. RUFFLED SKIRT
    for (let ry = -17; ry <= -15; ry++) {
      const minRx = -13;
      const maxRx = 12;
      for (let rx = minRx; rx <= maxRx; rx++) {
        let type = 'skirt';
        const foldPattern = (rx + 40) % 5;
        if (foldPattern === 0) {
          type = 'skirt_highlight';
        } else if (foldPattern === 1) {
          type = 'skirt_highlight_minor';
        } else if (foldPattern === 3) {
          type = 'skirt_shadow';
        } else if (foldPattern === 4) {
          type = 'skirt_shadow_deep';
        }

        if (ry === -15) {
          const isSpike = foldPattern === 0 || foldPattern === 1;
          if (!isSpike) continue;
        }

        pixels.push({ rx, ry, type });
      }
    }

    // 3. RIBBED GILLS
    for (let rx = -19; rx <= 18; rx++) {
      const gillType = (rx + 40) % 3;
      pixels.push({
        rx,
        ry: -18,
        type: gillType === 0 ? 'gills_light' : gillType === 1 ? 'gills_medium' : 'gills_dark',
      });
      pixels.push({
        rx,
        ry: -19,
        type: gillType === 0 ? 'gills_light' : 'gills_dark',
      });
    }

    // 4. CAP SHADOW UNDERBELLY
    for (let rx = -21; rx <= 20; rx++) {
      const isRim = rx <= -18 || rx >= 17;
      pixels.push({
        rx,
        ry: -20,
        type: isRim ? 'cap_shadow_rim' : 'cap_shadow',
      });
    }

    // 5. CAP DOME
    const capWidths: { [ry: number]: [number, number] } = {
      [-21]: [-21, 20],
      [-22]: [-22, 21],
      [-23]: [-23, 22],
      [-24]: [-23, 22],
      [-25]: [-23, 22],
      [-26]: [-23, 22],
      [-27]: [-22, 21],
      [-28]: [-22, 21],
      [-29]: [-21, 20],
      [-30]: [-21, 20],
      [-31]: [-20, 19],
      [-32]: [-19, 18],
      [-33]: [-18, 17],
      [-34]: [-17, 16],
      [-35]: [-16, 15],
      [-36]: [-15, 14],
      [-37]: [-14, 13],
      [-38]: [-12, 11],
      [-39]: [-10, 9],
      [-40]: [-8, 7],
      [-41]: [-6, 5],
      [-42]: [-3, 2],
    };

    for (let ry = -42; ry <= -21; ry++) {
      const [minRx, maxRx] = capWidths[ry];
      for (let rx = minRx; rx <= maxRx; rx++) {
        let type = 'cap_main';

        const isHighlightMajor =
          (ry >= -41 && ry <= -38 && rx >= minRx + 2 && rx <= minRx + 6) ||
          (ry >= -37 && ry <= -33 && rx >= minRx + 3 && rx <= minRx + 8) ||
          (ry >= -32 && ry <= -27 && rx >= minRx + 4 && rx <= minRx + 9);

        const isHighlightMinor =
          !isHighlightMajor && (
            (ry >= -42 && ry <= -38 && rx >= minRx + 1 && rx <= minRx + 9) ||
            (ry >= -37 && ry <= -32 && rx >= minRx + 2 && rx <= minRx + 13) ||
            (ry >= -31 && ry <= -25 && rx >= minRx + 3 && rx <= minRx + 15)
          );

        const isShadeRight = rx >= maxRx - 6;
        const isShadowRim = rx === maxRx || (ry === -21 && rx >= 10);

        if (isHighlightMajor) {
          type = 'cap_highlight_major';
        } else if (isHighlightMinor) {
          type = 'cap_highlight_minor';
        } else if (isShadowRim) {
          type = 'cap_shadow_rim';
        } else if (isShadeRight) {
          const dither = (rx + ry) % 2 === 0;
          type = dither ? 'cap_shade_right' : 'cap_main';
        }

        pixels.push({ rx, ry, type });
      }
    }

    // 6. SPOTS
    const spotSpecs = [
      { cx: -1, cy: -31, r: 4, id: 0 },
      { cx: -13, cy: -27, r: 3, id: 1 },
      { cx: 12, cy: -27, r: 3, id: 2 },
      { cx: -9, cy: -37, r: 2.2, id: 3 },
      { cx: 8, cy: -37, r: 2.2, id: 4 },
      { cx: -16, cy: -32, r: 1.8, id: 5 },
      { cx: 15, cy: -32, r: 1.8, id: 6 },
    ];

    if (options.spotStyle !== 'none') {
      spotSpecs.forEach(spec => {
        let active = false;
        if (options.spotStyle === 'classic') {
          active = true;
        } else if (options.spotStyle === 'minimal') {
          active = spec.id === 0;
        } else if (options.spotStyle === 'stars') {
          active = true;
        }

        if (active) {
          const rSq = spec.r * spec.r;
          const bound = Math.ceil(spec.r);

          for (let dy = -bound; dy <= bound; dy++) {
            for (let dx = -bound; dx <= bound; dx++) {
              if (options.spotStyle === 'stars') {
                const isStar = Math.abs(dx) <= 0.5 || Math.abs(dy) <= 0.5;
                const isWithinStar = Math.abs(dx) <= spec.r && Math.abs(dy) <= spec.r;
                if (!isStar || !isWithinStar) continue;
              } else {
                if (dx * dx + dy * dy > rSq) continue;
              }

              const rx = spec.cx + dx;
              const ry = spec.cy + dy;

              let type = 'spot';
              if (dx <= -0.5 && dy <= -0.5) {
                type = 'spot_highlight';
              } else if (dx >= 0.5 && dy >= 0.5) {
                type = 'spot_shadow';
              }

              pixels.push({ rx, ry, type });
            }
          }
        }
      });
    }

    // 7. BLUSH
    for (let ry = -8; ry <= -6; ry++) {
      for (let rx = -9; rx <= -6; rx++) {
        pixels.push({ rx, ry, type: 'blush' });
      }
      for (let rx = 5; rx <= 8; rx++) {
        pixels.push({ rx, ry, type: 'blush' });
      }
    }

    return pixels;
  },

  getDeformation: (state: ExpressionType, t: number): SpriteDeformation => {
    let scaleY = 1.0;
    let scaleX = 1.0;
    let offsetX = 0;
    let offsetY = 0;
    let rotation = 0;

    switch (state) {
      case 'idle':
        scaleY = 1.0 + Math.sin(t * 0.06) * 0.02;
        scaleX = 1.0 - Math.sin(t * 0.06) * 0.02;
        break;
      case 'happy': {
        const hBounce = -Math.abs(Math.sin(t * 0.1) * 5);
        scaleY = hBounce < -0.3 ? 1.08 : 0.92;
        scaleX = hBounce < -0.3 ? 0.92 : 1.08;
        offsetY = hBounce;
        break;
      }
      case 'excited': {
        const eBounce = -Math.abs(Math.sin(t * 0.16) * 9);
        scaleY = eBounce < -0.6 ? 1.16 : 0.82;
        scaleX = eBounce < -0.6 ? 0.84 : 1.18;
        offsetY = eBounce;
        break;
      }
      case 'thinking':
      case 'loading':
        scaleY = 0.98;
        scaleX = 1.02;
        rotation = Math.sin(t * 0.04) * 2.2;
        break;
      case 'sad':
      case 'error':
        scaleY = 0.86 + Math.sin(t * 0.03) * 0.01;
        scaleX = 1.08;
        offsetY = 3;
        break;
    }

    return { scaleX, scaleY, rotation, offsetX, offsetY };
  },

  getPalette: (options: CustomizationOptions): Record<string, string> => {
    const cap = options.capColor || '#eb6f92';
    const capShadow = options.capShadowColor || '#b74765';
    const stalk = options.stalkColor || '#fffaf3';
    const stalkShadow = options.stalkShadowColor || '#e0d8cc';
    const spot = options.spotColor || '#faf4ed';

    return {
      cap_main: cap,
      cap_shadow: capShadow,
      cap_shadow_rim: blendColors(capShadow, '#000000', 0.15),
      cap_highlight_major: blendColors(cap, '#ffffff', 0.55),
      cap_highlight_minor: blendColors(cap, '#ffffff', 0.25),
      cap_shade_right: blendColors(cap, capShadow, 0.45),

      gills_light: '#fdf6e2',
      gills_medium: '#ecdcb0',
      gills_dark: '#cca575',

      stalk: stalk,
      stalk_shadow: stalkShadow,
      stalk_skirt_shadow: blendColors(stalkShadow, '#000000', 0.2),
      stalk_shade_left: blendColors(stalk, stalkShadow, 0.5),
      stalk_highlight: blendColors(stalk, '#ffffff', 0.35),
      stalk_highlight_minor: blendColors(stalk, '#ffffff', 0.15),

      skirt: blendColors(stalk, '#ffffff', 0.85),
      skirt_highlight: '#ffffff',
      skirt_highlight_minor: blendColors(stalk, '#ffffff', 0.9),
      skirt_shadow: blendColors(stalkShadow, '#ffffff', 0.4),
      skirt_shadow_deep: blendColors(stalkShadow, '#000000', 0.15),

      spot: spot,
      spot_highlight: blendColors(spot, '#ffffff', 0.55),
      spot_shadow: blendColors(spot, capShadow, 0.35),

      blush: options.blushColor || '#ebbcba',
    };
  },

  getParticles: (state: ExpressionType, _t: number, pivotX: number, pivotY: number): Particle[] => {
    const particles: Particle[] = [];

    if (state === 'happy' || state === 'excited') {
      if (Math.random() < (state === 'excited' ? 0.35 : 0.15)) {
        particles.push({
          x: pivotX + (Math.random() * 30 - 15),
          y: pivotY - 35 + (Math.random() * 10 - 5),
          vx: (Math.random() - 0.5) * 0.8,
          vy: -Math.random() * 1.2 - 0.5,
          color: Math.random() > 0.5 ? '#f6c177' : '#eb6f92',
          alpha: 1.0,
          life: 0,
          maxLife: 40 + Math.random() * 20,
          size: Math.random() > 0.7 ? 2 : 1,
        });
      }
    } else if (state === 'thinking' || state === 'loading') {
      if (Math.random() < 0.12) {
        particles.push({
          x: pivotX + 18 + Math.random() * 4,
          y: pivotY - 20 - Math.random() * 5,
          vx: 0.2 + Math.random() * 0.3,
          vy: -0.4 - Math.random() * 0.4,
          color: '#c4a7e7',
          alpha: 0.9,
          life: 0,
          maxLife: 50 + Math.random() * 20,
          size: Math.random() > 0.5 ? 2 : 1,
        });
      }
    }

    return particles;
  },

  drawFace: (
    ctx: CanvasRenderingContext2D,
    state: ExpressionType,
    t: number,
    pivotX: number,
    pivotY: number,
    pixelScale: number,
    options: CustomizationOptions
  ) => {
    // Face overlay coordinates calculation
    const faceAnchorRx = 0;
    const faceAnchorRy = -10;
    const deform = shroomyTemplate.getDeformation(state, t);
    const rxDef = faceAnchorRx * deform.scaleX + (deform.rotation * (Math.abs(faceAnchorRy) / 42));
    const ryDef = faceAnchorRy * deform.scaleY;
    const faceX = Math.round(pivotX + rxDef + deform.offsetX);
    const faceY = Math.round(pivotY + ryDef + deform.offsetY);

    let leftEye: { x: number; y: number }[] = [];
    let rightEye: { x: number; y: number }[] = [];
    let sparkles: { x: number; y: number }[] = [];

    const isBlinking = Math.floor(t / 2) % 90 < 4;
    const eyeStyle = options.eyeStyle || 'bead';
    const eyeColor = options.eyeColor || '#26233a';

    if (isBlinking) {
      leftEye = [{ x: faceX - 6, y: faceY }, { x: faceX - 5, y: faceY }];
      rightEye = [{ x: faceX + 4, y: faceY }, { x: faceX + 5, y: faceY }];
    } else {
      switch (state) {
        case 'happy':
        case 'excited':
          leftEye = [
            { x: faceX - 7, y: faceY },
            { x: faceX - 6, y: faceY - 1 },
            { x: faceX - 5, y: faceY - 1 },
            { x: faceX - 4, y: faceY },
          ];
          rightEye = [
            { x: faceX + 3, y: faceY },
            { x: faceX + 4, y: faceY - 1 },
            { x: faceX + 5, y: faceY - 1 },
            { x: faceX + 6, y: faceY },
          ];
          break;
        case 'sad':
        case 'error':
          if (eyeStyle === 'anime') {
            leftEye = [{ x: faceX - 7, y: faceY - 1 }, { x: faceX - 6, y: faceY }];
            rightEye = [{ x: faceX + 4, y: faceY }, { x: faceX + 5, y: faceY - 1 }];
            sparkles.push({ x: faceX - 7, y: faceY });
            sparkles.push({ x: faceX + 5, y: faceY });
          } else {
            leftEye = [{ x: faceX - 7, y: faceY - 1 }, { x: faceX - 6, y: faceY - 1 }, { x: faceX - 6, y: faceY }];
            rightEye = [{ x: faceX + 4, y: faceY }, { x: faceX + 4, y: faceY - 1 }, { x: faceX + 5, y: faceY - 1 }];
          }
          break;
        default:
          if (eyeStyle === 'anime') {
            leftEye = [
              { x: faceX - 7, y: faceY - 2 }, { x: faceX - 6, y: faceY - 2 },
              { x: faceX - 7, y: faceY - 1 }, { x: faceX - 6, y: faceY - 1 },
              { x: faceX - 6, y: faceY }, { x: faceX - 5, y: faceY },
            ];
            rightEye = [
              { x: faceX + 4, y: faceY - 2 }, { x: faceX + 5, y: faceY - 2 },
              { x: faceX + 4, y: faceY - 1 }, { x: faceX + 5, y: faceY - 1 },
              { x: faceX + 4, y: faceY }, { x: faceX + 5, y: faceY },
            ];
            sparkles.push({ x: faceX - 7, y: faceY - 2 });
            sparkles.push({ x: faceX - 6, y: faceY - 1 });
            sparkles.push({ x: faceX + 4, y: faceY - 2 });
            sparkles.push({ x: faceX + 5, y: faceY - 1 });
          } else if (eyeStyle === 'minimal') {
            leftEye = [{ x: faceX - 6, y: faceY }];
            rightEye = [{ x: faceX + 5, y: faceY }];
          } else {
            leftEye = [
              { x: faceX - 6, y: faceY - 2 }, { x: faceX - 5, y: faceY - 2 },
              { x: faceX - 6, y: faceY - 1 }, { x: faceX - 5, y: faceY - 1 },
              { x: faceX - 6, y: faceY }, { x: faceX - 5, y: faceY },
            ];
            rightEye = [
              { x: faceX + 4, y: faceY - 2 }, { x: faceX + 5, y: faceY - 2 },
              { x: faceX + 4, y: faceY - 1 }, { x: faceX + 5, y: faceY - 1 },
              { x: faceX + 4, y: faceY }, { x: faceX + 5, y: faceY },
            ];
            sparkles.push({ x: faceX - 6, y: faceY - 2 });
            sparkles.push({ x: faceX + 4, y: faceY - 2 });
          }
          break;
      }
    }

    const drawPixelList = (coords: { x: number; y: number }[], color: string) => {
      ctx.fillStyle = color;
      coords.forEach(pt => {
        ctx.fillRect(pt.x * pixelScale, pt.y * pixelScale, pixelScale, pixelScale);
      });
    };

    drawPixelList(leftEye, eyeColor);
    drawPixelList(rightEye, eyeColor);
    drawPixelList(sparkles, '#ffffff');
  },
};
