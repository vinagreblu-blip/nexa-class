# Assets embarcados (PDF/A-1b da RVDD)

Arquivos usados pelo gerador da RVDD (`desktop/electron/diploma-digital/`)
para produzir PDF **PDF/A-1b** (ISO 19005-1): fontes TrueType EMBUTIDAS
(obrigatório no padrão — base-14 não embutida é não-conforme) e perfil ICC
sRGB para o OutputIntent (cores device-independent).

Empacotados via `extraResources` do electron-builder (`assets/` →
`resources/assets/`), mesmo padrão de `schemas/`. Resolução em runtime:
`process.resourcesPath/assets` primeiro, repositório em dev depois.

## Fontes — Noto Sans (SIL Open Font License 1.1)

- `fonts/NotoSans-Regular.ttf` — SHA-256 `478C558EA716033CD60C03438F628DFA75694DCF6B5F6D505A2F05FD2B4F3823`
- `fonts/NotoSans-Bold.ttf` — SHA-256 `1DF075A380FC7CB898ACF64C1F7B3B4DD780DE3CAA860178BF929DE35817A913`
- Fonte: https://github.com/notofonts/notofonts.github.io (hinted/ttf)
- Licença: `fonts/OFL.txt` (OFL 1.1 — redistribuição e embutimento permitidos)

## Perfil ICC — sRGB v2 "magic" (Compact-ICC-Profiles)

- `icc/sRGB-v2-magic.icc` — SHA-256 `AF4EFE28F6D311799865F325BA39184A2E978B113CA74124D60AF7DE22B105F4`
- Fonte: https://github.com/saucecontrol/Compact-ICC-Profiles (profiles/sRGB-v2-magic.icc)
- Perfil sRGB IEC 61966-2.1 v2 compacto, public domain; aceito pelo veraPDF
  como OutputIntentDestProfile.

O digest SHA-256 de cada arquivo é verificado no teste
(`pdfa-rvdd.test.ts`) — arquivo trocado/corrompido quebra o build.
