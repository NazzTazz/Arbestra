"""Run with Pillow after Blender bake(), before finish(). Originals remain 256x256."""
from pathlib import Path
from PIL import Image
OUT=Path(__file__).resolve().parents[1]
atlas=Image.new('RGB',(512,512),(85,55,30))
for idx,src in enumerate([OUT/'textures'/f'garden-stage-{s:02}-256.png' for s in range(1,8)]+[OUT/'textures'/'soil-source.png']):
    im=Image.open(src).convert('RGB').resize((120,120),Image.Resampling.LANCZOS)
    x,y=(idx%4)*128,(idx//4)*128
    atlas.paste(im,(x+4,y+4))
    atlas.paste(im.crop((0,0,1,120)).resize((4,120)),(x,y+4))
    atlas.paste(im.crop((119,0,120,120)).resize((4,120)),(x+124,y+4))
    atlas.paste(atlas.crop((x,y+4,x+128,y+5)).resize((128,4)),(x,y))
    atlas.paste(atlas.crop((x,y+123,x+128,y+124)).resize((128,4)),(x,y+124))
atlas.save(OUT/'textures'/'soil-and-lod2-atlas.png')
print('512x512 atlas: 7 stages + dirt; 128px slots, 120px content, 4px gutters.')
