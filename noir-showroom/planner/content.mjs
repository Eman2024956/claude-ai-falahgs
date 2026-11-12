// Copy and figures for the page. A brief describes how the site should look and
// move, not what the car is, so this is supplied separately. Brand, model and
// numbers are placeholders for a fictional car: replace them with real ones.

export const content = {
  title: 'ORSEN Nocturne GT',
  description: 'The ORSEN Nocturne GT. A grand tourer finished in black.',
  brand: 'ORSEN',
  sections: [
    {
      id: 'showroom',
      kind: 'hero',
      range: [0, 0.13],
      align: 'left',
      eyebrow: 'The new grand tourer',
      heading: 'Nocturne GT',
      body: 'Drawn in one line from nose to tail, and finished in a black that takes eleven coats to reach.',
      actions: [{ label: 'See the specification', href: '#performance' }],
    },
    {
      id: 'design',
      kind: 'statement',
      nav: 'Design',
      range: [0.2, 0.36],
      align: 'left',
      eyebrow: 'Design',
      heading: 'Light does the drawing',
      body: 'There is no chrome and no crease that is not needed. The body is one continuous surface, so the only lines you see are the ones the room puts there.',
    },
    {
      id: 'performance',
      kind: 'specs',
      nav: 'Performance',
      range: [0.44, 0.6],
      align: 'right',
      eyebrow: 'Performance',
      heading: 'Twin-motor, all-wheel drive',
      stats: [
        { label: '0 to 100 km/h', value: '2.9', unit: 's' },
        { label: 'Power', value: '720', unit: 'PS' },
        { label: 'Torque', value: '900', unit: 'Nm' },
        { label: 'Top speed', value: '325', unit: 'km/h' },
      ],
    },
    {
      id: 'dimensions',
      kind: 'specs',
      nav: 'Dimensions',
      range: [0.68, 0.83],
      align: 'left',
      eyebrow: 'Body and chassis',
      heading: 'Long, low and wide',
      stats: [
        { label: 'Length', value: '4,800', unit: 'mm' },
        { label: 'Wheelbase', value: '2,800', unit: 'mm' },
        { label: 'Kerb weight', value: '1,790', unit: 'kg' },
        { label: 'Drag coefficient', value: '0.24', unit: 'Cd' },
      ],
    },
    {
      id: 'commission',
      kind: 'cta',
      nav: 'Commission',
      range: [0.9, 1],
      align: 'center',
      eyebrow: 'Built to order',
      heading: 'Commission yours',
      body: 'Each Nocturne GT is specified with its owner. Tell us how you would like yours.',
      actions: [
        { label: 'Request a commission', href: 'mailto:atelier@orsen.example' },
        { label: 'Back to the showroom', href: '#showroom' },
      ],
    },
  ],
};
