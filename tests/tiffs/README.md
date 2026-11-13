Written by `scripts/tiff-fixtures.py`: first with Pillow (libtiff) from `tests/targets/external.png` in different modes
and compressions, then what Pillow doesn't write: BigTIFF, YCbCr, old-style LZW, fill order 2, odd tile widths,
associated alpha, 2- and 32-bit samples.

`damaged-*.tif` are files that ask for far more memory than they are, which the decoder has to refuse: YCbCr subsampling
factors of 65534 by 65535 and 1024 samples per pixel.
