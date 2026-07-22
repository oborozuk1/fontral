# Fontral

A local font library manager. It indexes tens of thousands of font files into a local database so you can search, preview, and compare them instantly. Fonts can also be temporarily activated at the system level for use by third-party apps, and are automatically cleaned up on exit with no residue left behind.

## Development

```bash
pnpm install
pnpm dev
```

## Build, Test, Package

```bash
pnpm typecheck
pnpm build
pnpm test

pnpm pack:win       # Windows unpacked directory
pnpm dist:win       # Windows NSIS installer + portable exe
pnpm dist:mac       # macOS dmg + zip
pnpm dist:linux     # Linux AppImage + deb
```
