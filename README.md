# Basecamps · Visor de ressenyes protegit

Visor de ressenyes i evidències publicat a GitHub Pages, amb accés per contrasenya i contingut xifrat.

## Dashboard de respostes i plataformes

El microsite del dashboard és a **https://marcgrisolia-ai.github.io/basecamps-ressenyes/dashboard/**. Comparteix la protecció i la sessió del visor. El paquet xifrat conté el mateix HTML compilat, snapshot complet i auditoria que la versió local; les dades no es publiquen en clar al repositori.

La versió del 14/10/2026 compta només ressenyes amb comentari escrit. Els recomptes, els estats de resposta i les auditories es conserven dins del paquet xifrat. El dashboard declara les dates de les proves i els comentaris amb data original pendent, exclosos. La publicació no representa una nova auditoria completa en viu.

Els filtres de la vista es conserven als paràmetres del link d’entrada `/dashboard/`. Per obrir una vista general, utilitzar aquest enllaç sense filtre de negoci o plataforma.

## Què es publica

- `site/index.html`, `gate.js` i `sw.js`: pantalla d’accés, navegació i sessió.
- `site/dashboard/index.html`: entrada pública sense dades que redirigeix a la mateixa pantalla d’accés.
- `site/payload.bin`: tots els HTML, CSS, JSON i documents de text del visor i dashboard, comprimits i xifrats.
- `site/crypto.json`: salt, vector d’inicialització i paràmetres de xifrat; no conté la contrasenya ni un hash de verificació de la contrasenya.

El repositori públic no conté ressenyes ni evidències en clar. `private-source/`, `.env` i `.env.*` estan exclosos de Git.

## Com funciona l’accés

La publicació local deriva una clau AES de 256 bits amb PBKDF2-SHA-256 (600.000 iteracions i salt aleatori), comprimeix el conjunt i el xifra amb AES-GCM. El navegador deriva la mateixa clau amb la contrasenya introduïda. Una contrasenya incorrecta no desxifra el paquet.

Un service worker serveix les pàgines i evidències desxifrades només dins d’una sessió vàlida. La contrasenya no s’emmagatzema al navegador. Per permetre recarregar i obrir evidències en pestanyes, es conserva una clau de sessió no exportable a IndexedDB, durant un màxim de 8 hores. «Tanca la sessió» elimina aquesta clau i redirigeix les pestanyes d’evidències al formulari d’accés. Les respostes desxifrades no es guarden a Cache Storage.

GitHub Pages és estàtic: aquesta protecció és xifrat del contingut, no un servidor de comptes. No hi ha limitació de temptatives al servidor. Qui conegui la contrasenya pot consultar i descarregar el contingut. El domini anterior de Sites és independent; publicar aquí no el retira ni en modifica l’accés.

## Actualització local

1. Conservar els HTML/CSS del visor a `private-source/`, amb `index.html` a l’arrel i `evidencies/` al costat. Copiar el build verificat del dashboard —HTML, snapshot JSON i auditoria— a `private-source/dashboard/`, preservant els bytes i els hashes.
2. Copiar `.env.example` a `.env` i definir `BASECAMPS_ACCESS_PASSWORD` (fitxer local amb permisos `600`).
3. Executar `npm run build`, `npm test` i `npm run verify`.
4. Confirmar i pujar únicament el codi i `site/`.

GitHub Actions verifica i publica el paquet ja xifrat. La contrasenya **no es puja**, tampoc a les variables de GitHub Actions. Per canviar-la, modificar el `.env` local i reconstruir: les claus de sessions anteriors deixaran de desxifrar el paquet nou quan es recarregui.

La protecció cobreix aquesta còpia de GitHub Pages. No modifica cap plataforma de ressenyes ni còpies prèviament publicades en altres dominis.
