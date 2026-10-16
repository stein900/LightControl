# Logiciels tiers

## Code réimplémenté dans ce dépôt

### lian-li-linux

Le protocole sans fil Lian Li (`src/main/hardware/lianli/protocol.ts`) est réimplémenté en TypeScript d’après le projet [lian-li-linux](https://github.com/sgtaziz/lian-li-linux). Les données de test de `tinyuz.test.ts` proviennent aussi de ce projet.

```
MIT License

Copyright (c) 2026 sgtaziz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### tinyuz

Le format de compression tinyuz (`src/main/hardware/lianli/tinyuz.ts`) suit [tinyuz](https://github.com/sisong/tinyuz). Le décodeur est porté du code d’origine ; l’encodeur est une implémentation distincte.

```
The MIT License (MIT)
Copyright (c) 2012-2025 HouSisong All Rights Reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Composants téléchargés à l’installation et livrés dans l’installateur

Ces composants ne sont pas versionnés dans ce dépôt : `scripts/fetch-vendor.mjs` les télécharge dans `vendor/` depuis leurs sources officielles.

| Composant | Licence | Source |
| --- | --- | --- |
| OpenRGB 1.0 (exécuté comme processus séparé) | GPL-2.0 | <https://codeberg.org/OpenRGB/OpenRGB> |
| libusb-1.0 (livrée avec OpenRGB) | LGPL-2.1 | <https://libusb.info> |
| Corsair iCUE SDK 4.0.84 (runtime redistribuable) | Licence du SDK Corsair | <https://github.com/CorsairOfficial/cue-sdk> |

La licence d’OpenRGB et ses mentions sont copiées à côté de l’exécutable (`resources/openrgb`).
