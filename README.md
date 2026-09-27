# PicEyeSo

An independent project: macular thickness as a 3D picture. Type nine ETDRS
numbers, or open an OCT volume in the desktop app. Your scan stays on that
computer.

This is not a medical device. It has not been clinically validated. The
source is closed for now.

[Gallery](https://rahulnadkarni.github.io/piceyeso/) ·
[Download the app](https://rahulnadkarni.github.io/piceyeso/app.html)

Questions or collaboration: [Rahul Nadkarni](https://github.com/RahulNadkarni).

## Supported files

A scan opens in the **desktop app**. The file is not uploaded. The website is
a gallery of example eyes.

| What you have | Open this | Do not open |
| --- | --- | --- |
| Heidelberg Spectralis | `.vol` or `.e2e` | — |
| Heidelberg export | the folder or `.zip` (`.xml` **plus** the TIFF B-scans) | the `.xml` by itself |
| Topcon | `.fda` | — |
| Zeiss Cirrus | a DICOM export (a `.dcm` / `.dicom`, or a folder of extensionless DICOM files) | the native `.img` cube |
| B-scan TIFF stack | the folder of `.tif` / `.tiff` (or one file from that folder) | a single photo TIFF with no siblings |
| Nine ETDRS sector thicknesses | type them, or upload a table | a PDF printout, a JPEG, or a screenshot |

PDF, PNG, and JPEG are not volumes. If you only have the nine numbers,
type them under **Type values**.

## How to use

1. [Download PicEyeSo](https://rahulnadkarni.github.io/piceyeso/app.html)
   for Mac (Apple silicon), Windows, or Linux.
2. **Mac:** this build is not signed. Double-click will refuse. Right-click
   PicEyeSo → **Open** → **Open**. If it still refuses: System Settings →
   Privacy & Security → **Open Anyway**. Prefer the disk image.
3. A PicEyeSo window opens. It is its own application, not a browser tab.
4. **Open a scan** for a `.vol`, `.e2e`, `.fda`, or DICOM.
   **Open a folder** for a TIFF stack, a Heidelberg XML+TIFF export, or a
   Cirrus DICOM folder. You can also paste a path. Or **Type values**
   and enter the nine ETDRS sector thicknesses.
5. A volume takes a minute or two (B-scans show first, then the 3D cap).
   Typed ETDRS numbers move the surface immediately.
6. Drag to orbit, scroll to zoom. Click the cap (or a sector on the left)
   to see that B-scan.
7. **Layer** picks which slab drives the surface. **View** can switch from
   the 3D cap to the ETDRS bullseye or a layered stack.
8. **Export PNG** writes a picture of the current view, including the
   colour scale. Opened scans stay on this computer.

## Screenshots

**Empty window.** Open a scan, a folder, or type nine ETDRS numbers.

![Empty PicEyeSo window](docs/screenshots/01-empty.png)

**OCT volume.** The line on the cap is the B-scan on the right (DME7).

![3D macular cap next to its B-scan](docs/screenshots/02-oct.png)

**ETDRS bullseye.** Nine typed sector thicknesses, no volume required.

![ETDRS bullseye from nine typed numbers](docs/screenshots/03-bullseye.png)

**Layer.** The dropdown is which slab moves the surface (here IS/OS).

![Layer menu on the 3D cap](docs/screenshots/04-layers.png)

**Layered stack.** Each retinal layer as its own disc.

![Layered stack view](docs/screenshots/05-stack.png)

## About this project

The [gallery](https://rahulnadkarni.github.io/piceyeso/) shows example eyes
and a 3D cap you can orbit. Type nine ETDRS numbers there. Open a clinic
volume in the [desktop app](https://rahulnadkarni.github.io/piceyeso/app.html).
Device layer lines are kept when the file already has them. Sectors the
scan does not cover stay blank.

This is a personal project, not a medical device. It has not been
clinically validated. The source is closed for now.

BrainPainter (Marinescu et al., MICCAI MBIA 2019) is the idea: numbers in,
a 3D object out. Duke public OCT (Srinivasan et al., *Biomed. Opt. Express*
2014) is used only as published example data.

Questions: [Rahul Nadkarni](https://github.com/RahulNadkarni) or
rahulnadkarni2002@gmail.com.

## License

Copyright © 2026 Rahul Nadkarni. **All rights reserved.** This is not MIT
or another open-source license. The gallery and desktop app may be used to
view your own data on your own machine. Source may not be copied or
redistributed without permission. See `LICENSE`.
