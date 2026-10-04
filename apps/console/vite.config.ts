import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const productionCsp = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://testnet-rpc.monad.xyz; base-uri 'none'; object-src 'none'";

export default defineConfig(({ command }) => ({
  envDir: '../../',
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
