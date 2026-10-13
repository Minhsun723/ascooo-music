export const ARTWORK_ASSET_VERSION = 'v1';
export const ARTWORK_SIZES = [512, 2000] as const;

export type ArtworkSize = (typeof ARTWORK_SIZES)[number];

export function isArtworkSize(value: number): value is ArtworkSize {
  return ARTWORK_SIZES.includes(value as ArtworkSize);
}

export function artworkObjectKey(id: string, size: ArtworkSize): string {
  return `art/${ARTWORK_ASSET_VERSION}/${id}/${size}.webp`;
}
