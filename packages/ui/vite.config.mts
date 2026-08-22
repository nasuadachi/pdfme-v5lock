import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';

const pdfjsViteIgnorePlugin = () => ({
  name: 'pdfjs-vite-ignore',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (!id.includes('/pdfjs-dist/') || !id.endsWith('/pdf.mjs')) return undefined;

    const transformed = code.replaceAll(
      'import(/*webpackIgnore: true*/this.workerSrc)',
      'import(/*webpackIgnore: true*/ /* @vite-ignore */ this.workerSrc)',
    );
    return transformed === code ? undefined : { code: transformed, map: null };
  },
});

export default defineConfig(({ mode }) => {
  return {
    define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
    plugins: [pdfjsViteIgnorePlugin(), react(), tsconfigPaths({ root: '.' }), cssInjectedByJsPlugin()],
    build: {
      lib: {
        entry: 'src/index.ts',
        name: '@pdfme/ui',
        fileName: (format) => `index.${format}.js`,
      },
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'pdfjs-dist', 'antd'],
      exclude: ['@pdfme/common', '@pdfme/schemas', '@pdfme/converter'],
    },
  };
});
