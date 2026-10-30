// hls.js ships no types for its light build. Its API is the full build's,
// minus features (alternate audio, subtitles, DRM) motion artwork never uses.
declare module 'hls.js/light' {
  export * from 'hls.js';
  export { default } from 'hls.js';
}
