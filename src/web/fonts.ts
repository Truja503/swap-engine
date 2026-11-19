import manrope from '@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2';
import plex from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2';

export const fonts = Promise.allSettled([
  new FontFace('Manrope Variable', manrope, { weight: '200 800', display: 'swap' }).load(),
  new FontFace('IBM Plex Mono', plex, { weight: '400', display: 'swap' }).load(),
]).then(results => {
  for (const result of results) if (result.status === 'fulfilled') document.fonts.add(result.value);
});
