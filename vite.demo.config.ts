import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * The demo build: one self-contained file with sample data, where importing, exporting and saving are off.
 * The private parts-time list and the shop-website script are left out of it.
 */
const leaveOut = (): Plugin => ({
  name: 'demo-leave-out',
  enforce: 'pre',
  resolveId(id) {
    if (id.includes('builtin-part-times.json')) return '\0demo:no-part-list';
    if (id.includes('shop-helper/helper.js')) return '\0demo:no-script';
    return null;
  },
  load(id) {
    if (id === '\0demo:no-part-list') return 'export default undefined;';
    if (id === '\0demo:no-script') return 'export default "// The shop website scripts come with the full app, not with this demo.";';
    return null;
  },
});

export default defineConfig({
  plugins: [leaveOut(), react(), tailwindcss(), viteSingleFile()],
  define: { 'import.meta.env.VITE_DEMO': JSON.stringify('1') },
  build: { outDir: 'dist-demo', assetsInlineLimit: 100000000 },
});
