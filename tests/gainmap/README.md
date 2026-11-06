Ultra HDR (gain map) JPEGs written by Google's libultrahdr v2.0.2 (`ultrahdr_app -m 0`, Apache-2.0) from a synthetic
512x384 picture (a bright sky gradient over dark stripes, as a 10-bit HLG HDR and an 8-bit SDR rendition), with ISO
21496-1 gain map metadata:

- `multi-channel.jpg`: a gain map per color channel (`-M 1`)
- `single-channel.jpg`: one gain map for all channels (`-M 0`)
- `stripped.jpg`: only the primary image of `multi-channel.jpg`, its MPF index still listing the cut off gain map (as
  chat apps and some uploads leave them)
- `malformed.jpg`: `multi-channel.jpg` with the gain map's ISO 21496-1 block zeroed (a zero denominator)
