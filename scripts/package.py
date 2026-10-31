"""Build a VSIX from the compiled TypeScript extension."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape
root = Path(__file__).resolve().parent.parent
p = json.loads((root / 'package.json').read_text())
manifest = f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
<Metadata><Identity Language="en-US" Id="{escape(p['name'])}" Version="{p['version']}" Publisher="{p['publisher']}"/><DisplayName>{escape(p['displayName'])}</DisplayName><Description xml:space="preserve">{escape(p['description'])}</Description><Tags>xcode,simulator,ios</Tags><Categories>Other</Categories><GalleryFlags>Public</GalleryFlags><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="{p['engines']['vscode']}"/><Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui"/></Properties><License>extension/LICENSE</License></Metadata>
<Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/>
<Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true"/></Assets>
</PackageManifest>'''
target = root / f"{p['name']}-{p['version']}.vsix"
with ZipFile(target, 'w', ZIP_DEFLATED) as z:
    z.writestr('extension.vsixmanifest', manifest)
    z.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="png" ContentType="image/png"/><Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="vsixmanifest" ContentType="text/xml"/><Default Extension="txt" ContentType="text/plain"/><Override PartName="/extension/LICENSE" ContentType="text/plain"/></Types>')
    for file in [root/'package.json', root/'README.md', root/'LICENSE', *sorted((root/'build'/'src').glob('*.js')), *sorted((root/'media').glob('*'))]:
        z.write(file, 'extension/' + file.relative_to(root).as_posix())
print(target)
