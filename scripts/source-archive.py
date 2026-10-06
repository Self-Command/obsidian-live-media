"""Actions-only codec Corresponding Source retrieval, with resolved commit and license evidence."""
import os, pathlib, subprocess, json, re
if os.environ.get('GITHUB_ACTIONS') != 'true':
    raise SystemExit('Only GitHub Actions may prepare encoder distribution inputs')
root=pathlib.Path('build/codec-sources'); root.mkdir(parents=True,exist_ok=True)
def clone(name,url,ref):
    target=root/name
    subprocess.run(['git','clone','--quiet','--filter=blob:none','--no-checkout',url,str(target)],check=True)
    subprocess.run(['git','-C',str(target),'checkout','--quiet',ref],check=True)
    sha=subprocess.check_output(['git','-C',str(target),'rev-parse','HEAD'],text=True).strip()
    return {'name':name,'source':url,'requestedRef':ref,'commit':sha}
info=[]
for project in root.iterdir():
    if not project.is_dir():continue
    sha=subprocess.check_output(['git','-C',str(project),'rev-parse','HEAD'],text=True).strip()
    url=subprocess.check_output(['git','-C',str(project),'remote','get-url','origin'],text=True).strip()
    info.append({'name':project.name,'source':url,'commit':sha})
(root/'source-provenance.json').write_text(json.dumps(info,indent=2))
licenses=pathlib.Path('dist/licenses');licenses.mkdir(parents=True,exist_ok=True)
for project in root.iterdir():
    if not project.is_dir():continue
    candidates=list(project.glob('COPYING*'))+list(project.glob('LICENSE*'))
    for path in candidates:
        if path.is_file(): (licenses/(project.name+'-'+path.name)).write_bytes(path.read_bytes())
# Sources are those used to build this artifact, not a proposed reconstruction of an npm binary.
