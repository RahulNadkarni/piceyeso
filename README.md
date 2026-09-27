# PicEyeSo

Software that turns macular thickness into a 3D picture, in the same sense
[BrainPainter](https://razvanmarinescu.com/publication/brainpainter/) turns a
list of numbers into a brain. An ETDRS table or an OCT volume becomes a macular
cap whose *shape* is the thickness. A 200 µm sector next to a 300 µm one is a
valley, not only a colour.

[Gallery](https://rahulnadkarni.github.io/piceyeso/) ·
[Download the app](https://rahulnadkarni.github.io/piceyeso/app.html)

The source is not public. For access, collaboration, or a methods question,
contact [Rahul Nadkarni](https://github.com/RahulNadkarni).

## For ophthalmologists

The website is a gallery of example eyes. A patient’s scan is opened in the
**desktop app** on your computer. The file is not uploaded.

1. [Download PicEyeSo](https://rahulnadkarni.github.io/piceyeso/app.html)
   for Mac, Windows, or Linux.
2. **Mac:** the app is unsigned. Right-click → Open → Open the first time.
   Double-click is blocked by Gatekeeper. Prefer the disk image when it is on
   the download page.
3. A PicEyeSo window opens. It is its own application, not a browser tab.
4. Open a Heidelberg `.vol`, a TIFF or XML export folder, a `.zip`, Topcon
   `.fda`, or DICOM. Or paste a path on this computer.
5. Thickness moves the surface. Click the cap to see that B-scan.

Opened scans stay on the machine. They are not written into the app itself.

## For researchers and academics

The [public gallery](https://rahulnadkarni.github.io/piceyeso/) is the
citable front end: example eyes, an ETDRS CSV you can drop on the page, and
the same 3D cap a reader can orbit. The page does not show anomaly scores.

Use the [desktop app](https://rahulnadkarni.github.io/piceyeso/app.html)
when you need a clinic volume, not only a nine-number table. Device layer
lines are kept when the file already has them. Sectors the scan does not
cover stay blank. A follow-up movie is interpolated visits of **one** eye —
do not morph two different eyes.

BrainPainter (Marinescu et al., MICCAI MBIA 2019) is the model: numbers in,
a 3D object out. Duke public OCT (Srinivasan et al., *Biomed. Opt. Express*
2014) is used only as published example data.

Methods, a research license, or a collaboration: contact
[Rahul Nadkarni](https://github.com/RahulNadkarni). That is how source and
reproducibility materials are shared. They are not in this repository.
