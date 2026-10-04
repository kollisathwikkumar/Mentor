import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const productionCsp = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://testnet-rpc.monad.xyz; base-uri 'none'; object-src 'none'";

export default defineConfig(({ command }) => ({
  envDir: '../../',
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        'oauth-approve': fileURLToPath(new URL('./src/oauth-approve.ts', import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) => chunk.name === 'oauth-approve' ? 'assets/oauth-approve.js' : 'assets/[name]-[hash].js',
      },
    },
  },
  plugins: [
    react(),
    {
      name: 'mandate-production-csp',
      transformIndexHtml: command === 'build'
        ? (html: string) => html.replace('</head>', `  <meta http-equiv="Content-Security-Policy" content="${productionCsp}" />\n  </head>`)
        : undefined,
    },
  ],
}));
