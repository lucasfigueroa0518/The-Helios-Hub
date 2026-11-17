// A dog treat (once alive, so drawn). Rigid: one part. Units: 56 tall, 110 wide, lying flat.
export const BONE = {
  kind: 'bone', cm: 9, units: 56,
  tones: { biscuit: 'mustard-lit' },
  views: {
    side: {
      parts: {
        bone: {
          z: 0, fill: 'biscuit', pivot: [0, -24],
          d: 'M-36,-38 C-44,-52 -62,-50 -64,-40 C-67,-32 -63,-27 -57,-24 C-66,-19 -68,-9 -61,-3 C-55,2 -43,0 -38,-8 C-20,-13 18,-12 38,-9 C45,0 57,1 62,-5 C67,-11 65,-20 58,-24 C64,-28 67,-34 63,-41 C58,-50 43,-50 36,-38 C18,-34 -18,-35 -36,-38 Z',
          shade: 'M-70,-14 C-50,-8 -30,-10 0,-12 C30,-12 50,-6 70,-16 L70,6 L-70,6 Z',
          lines: ['M-22,-26 l3,0 M-6,-22 l3,0 M12,-27 l3,0 M26,-21 l3,0', 'M-54,-38 C-50,-42 -46,-42 -43,-40', 'M44,-42 C48,-44 52,-43 55,-40'],
        },
      },
      poses: { rest: {} },
    },
  },
};
