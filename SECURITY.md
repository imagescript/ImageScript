# Security policy

## Supported versions

Security fixes go into the latest release of the current major version (4.x). 3.x gets fixes for serious problems on the
[`v3` branch](https://github.com/imagescript/ImageScript/tree/v3) while 3.20.x is current. Older versions don't get fixes.

## Reporting a vulnerability

Please report vulnerabilities privately, not in a public issue:

- through a [private security advisory](https://github.com/imagescript/ImageScript/security/advisories/new) on GitHub, or
- by email to [github@matmen.dev](mailto:github@matmen.dev).

A short description and a file, SVG or script that shows the problem help most. We aim to answer within a week. We
will tell you when a fix is released and credit you, unless you prefer not to be named.

## What counts

ImageScript decodes image files, fonts and SVG documents that often come from untrusted sources. Reports we want:

- code execution, or reading or writing outside the memory a decoder owns;
- a small input that makes a decoder, the SVG renderer or the text renderer run out of memory, hang, or take far longer than
  its size and the documented limits (`maxPixels`, `maxLayerPixels`, `maxImagePixels` and the work limits that throw a
  `LimitError`) allow;
- output that depends on data it should not read (for example, an SVG that reads files or fetches URLs: ImageScript does
  not fetch anything and takes external images only as data you pass in).

Limits that grow with the size of the output (the SVG work budgets) are documented: for untrusted input, lower
`maxPixels`. A document that stays within the limits but is slow on a large output is not a vulnerability.
