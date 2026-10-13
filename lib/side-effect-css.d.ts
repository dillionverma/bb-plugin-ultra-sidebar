// app.tsx and text-shimmer.tsx import stylesheets for their side effect, and
// `bb plugin build` folds them into dist/app.css. TypeScript 7 checks that a
// side-effect import resolves, so it needs to know a .css path is a module.
declare module "*.css";
