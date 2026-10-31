import { defineConfig } from 'vitest/config';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  // GitHub Pages のサブパス配下でも動くよう相対パスで出力する
  base: './',
  // Rapier の WASM を base64 で JS に埋め込まず、.wasm ファイルのまま配る
  plugins: [wasm()],
  build: {
    // Rapier の WASM の読み込みに top-level await を使う
    target: 'es2022',
    // three.js を含むゲーム本体が 800kB 強ある
    chunkSizeWarningLimit: 1000,
  },
  test: {
    environment: 'node',
    // Rapier（.wasm を import するパッケージ）もテストで Vite の変換を通す
    server: { deps: { inline: ['@dimforge/rapier3d'] } },
    // package.json に main が無く Node 向けの解決に失敗するので、入口のファイルを直接指す
    alias: { '@dimforge/rapier3d': '@dimforge/rapier3d/rapier.js' },
    // 重い NPC のシミュレーション（*.sim.test.ts）を CPU の数だけ並列に走らせる（既定は1つ少ない）
    maxWorkers: '100%',
  },
});
