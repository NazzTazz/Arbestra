"""Arbestra V8. Run in Blender: exec(compile(open(path, encoding='utf-8').read(), path, 'exec')).
Independent of V7: builds new scenes, never removes existing scenes. OUT may be supplied.
Step 1 build(); step 2 bake(); step 3 finish() after assemble_atlas.py.
Units metres; Blender XY ground/Z up. Export Y up, identity kit transforms.
"""
import bpy, math, random, json
from pathlib import Path
from mathutils import Vector, Matrix

OUT = Path(globals().get('V8_OUT', Path(__file__).resolve().parents[1]))
for sub in ['assets','sources','textures','previews','reference']:
    (OUT/sub).mkdir(parents=True, exist_ok=True)
KIT = {}; MATS = {}; SCENES = {}; PLACEMENTS = {}
SUN = Vector((-.35,-.5,1)).normalized()
ORANGE = (.78,.205,.023)
GREEN = (.12,.33,.027)

def scene(name):
    s=bpy.data.scenes.new('V8 '+name)
    s.render.engine='BLENDER_EEVEE'
    s.render.resolution_x=900; s.render.resolution_y=760; s.render.resolution_percentage=100
    s.render.image_settings.file_format='PNG'
    s.world=bpy.data.worlds.new('V8 world '+name); s.world.use_nodes=True
    bg=next(n for n in s.world.node_tree.nodes if n.type=='BACKGROUND')
    bg.inputs[0].default_value=(.032,.042,.037,1)
    s.view_settings.view_transform='Standard'
    s.view_settings.look='None'
    s.view_settings.exposure=0; s.view_settings.gamma=1
    s.unit_settings.system='METRIC'
    SCENES[name]=s
    return s

def material(name, texture=None):
    m=bpy.data.materials.new('V8_'+name); m.use_nodes=True; m.use_backface_culling=True
    ns=m.node_tree.nodes; ns.clear(); ls=m.node_tree.links
    out=ns.new('ShaderNodeOutputMaterial'); vc=ns.new('ShaderNodeVertexColor'); vc.layer_name='Color'
    color=vc.outputs['Color']
    if texture:
        tex=ns.new('ShaderNodeTexImage'); tex.image=bpy.data.images.load(str(OUT/'textures'/texture),check_existing=False)
        mix=ns.new('ShaderNodeMixRGB'); mix.blend_type='MULTIPLY'; mix.inputs[0].default_value=1
        ls.new(tex.outputs['Color'],mix.inputs[1]); ls.new(color,mix.inputs[2]); color=mix.outputs[0]
    # Direct color -> surface is the glTF exporter's native unlit pattern.
    ls.new(color,out.inputs['Surface']); MATS[name]=m
    return m

class Geo:
    def __init__(self): self.v=[]; self.f=[]; self.c=[]
    def add(self,v,f,col):
        off=len(self.v); self.v.extend(v); self.f.extend([tuple(off+i for i in p) for p in f])
        self.c.extend([col]*len(f))
    def tetra(self,a,b,c,d,col):
        verts=[Vector(x) for x in (a,b,c,d)]; faces=[(0,1,2),(0,3,1),(1,3,2),(2,3,0)]
        center=sum(verts,Vector())/4
        for j,f in enumerate(faces):
            n=(verts[f[1]]-verts[f[0]]).cross(verts[f[2]]-verts[f[0]])
            if n.dot(sum((verts[i] for i in f),Vector())/3-center)<0: faces[j]=f[::-1]
        self.add(verts,faces,col)
    def leaf(self,base,tip,width,col):
        a=Vector(base); t=Vector(tip); axis=t-a
        side=Vector((-axis.y,axis.x,0)).normalized()*width
        mid=a+axis*.52
        self.tetra(a,mid+side,t,mid-side+Vector((0,0,.008)),col)
    def root(self,rings,sides,col,curved=False):
        v=[]; f=[]
        for z,r in rings:
            cx=.075*(1-z/.94)**2 if curved else 0
            for j in range(sides):
                a=math.tau*j/sides
                v.append((cx+r*math.cos(a),r*math.sin(a),z))
        for k in range(len(rings)-1):
            for j in range(sides): f.append((k*sides+j,k*sides+(j+1)%sides,(k+1)*sides+(j+1)%sides,(k+1)*sides+j))
        f.extend([tuple(reversed(range(sides))),tuple((len(rings)-1)*sides+j for j in range(sides))])
        self.add(v,f,col)

def mesh(name,g,mat,uvmode='xy',shade=True):
    me=bpy.data.meshes.new(name); me.from_pydata(g.v,[],g.f); me.update()
    me.materials.append(MATS[mat]); uv=me.uv_layers.new(name='UVMap')
    colors=me.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
    for p,col in zip(me.polygons,g.c):
        fac=(.32+.68*max(0,p.normal.dot(SUN))) if shade else 1
        for li in p.loop_indices:
            co=me.vertices[me.loops[li].vertex_index].co
            if uvmode=='wood':
                length=max(v.co.x for v in me.vertices)-min(v.co.x for v in me.vertices)
                u,v=(co.x/length+.5,co.y/.17+.5) if abs(p.normal.z)>.5 else ((co.x/length+.5,co.z*5+.04) if abs(p.normal.y)>.5 else (co.y*3+.2,co.z*8+.1))
            elif uvmode=='post': u,v=co.z*1.8,co.x*10+.35
            else: u,v=co.x*.4+.5,co.y*.4+.5
            uv.data[li].uv=(u,v)
            colors.data[li].color=(*(c*fac for c in col),1)
    ob=bpy.data.objects.new(name,me); SCENES['kit'].collection.objects.link(ob)
    KIT[name]=ob
    return ob

def tris(ob): ob.data.calc_loop_triangles(); return len(ob.data.loop_triangles)

def plant(stage,lod=0):
    g=Geo()
    if stage==1:
        g.tetra((-.018,-.007,0),(.018,-.007,0),(0,.011,0),(0,0,.004),(.12,.058,.02))
        return g
    scale=[0,0,.26,.45,.68,.80,.91,1][stage]
    if lod==1:
        # Two upward triangles for the foliage; root is a closed tetrahedron.
        for a in [0,2.2]:
            d=Vector((math.cos(a),math.sin(a),0)); w=Vector((-d.y,d.x,0))*.035*scale
            b=Vector((0,0,.018*scale)); tip=d*.075*scale+Vector((0,0,.14*scale))
            g.add([b-w,b+w,tip],[(1,0,2)],GREEN)
        if stage>=5:
            r=.021*scale
            g.tetra((0,0,-.022),(-r,-r,.026*scale),(r,-r,.026*scale),(0,r,.026*scale),ORANGE)
        return g
    leaf_count={2:2,3:3,4:4,5:4,6:4,7:4}[stage]
    for j in range(leaf_count):
        a=j*2.399+.3
        tip=(math.cos(a)*.075*scale,math.sin(a)*.075*scale,(.12+.025*(j%2))*scale)
        g.leaf((0,0,.018*scale),tip,.018*scale,tuple(c*(.82+.07*j) for c in GREEN))
    if stage>=5:
        sides={5:3,6:4,7:5}[stage]
        # One cone, closed bottom/top: 2*n-2 triangles.
        r=.022*scale; vs=[(0,0,-.028)]
        vs += [(r*math.cos(j*math.tau/sides),r*math.sin(j*math.tau/sides),.028*scale) for j in range(sides)]
        fs=[(0,1+(j+1)%sides,1+j) for j in range(sides)]+[tuple(range(1,sides+1))]
        g.add(vs,fs,ORANGE)
    return g

def ridge_z(x,s,k):
    t=(x+1.24)/2.48
    taper=min(1,max(0,(1-abs(2*t-1))/.15))
    return -.012+taper*(.205+.022*math.sin(t*13+k)+.012*math.sin(t*31+2*k))*max(0,1-s*s)**1.6

def ridge_y(x,s,k):
    t=(x+1.24)/2.48
    return (.022*math.sin(t*9+k)+.015*math.sin(t*21+2*k))*.6+s*(.30+.026*math.sin(t*17+k))*.6

def ridge(k,lod):
    # 12*4*2=96 / 4*4*2=32 triangles; open upward shell, underside rests in soil.
    nx=12 if lod==0 else 4; ny=4
    g=Geo(); v=[]; f=[]
    for i in range(nx+1):
        x=-1.24+2.48*i/nx
        for j in range(ny+1):
            s=-1+2*j/ny; v.append((x,ridge_y(x,s,k),ridge_z(x,s,k)))
    for i in range(nx):
        for j in range(ny):
            a=i*(ny+1)+j; f.append((a,a+ny+1,a+ny+2,a+1))
    g.add(v,f,(.93,.90,.84)); return g

def box(length,width,height):
    g=Geo(); x=length/2; y=width/2
    g.add([(-x,-y,0),(x,-y,0),(x,y,0),(-x,y,0),(-x,-y,height),(x,-y,height),(x,y,height),(-x,y,height)],[(0,3,2,1),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)],(1,1,1)); return g

def rope(lod):
    g=Geo(); v=[]; f=[]; L=1.25; a=1.8
    def z(x): return .306+a*(math.cosh((x-L/2)/a)-math.cosh(L/2/a))
    if lod==0:
        n=7
        for i in range(n+1):
            x=L*i/n
            tangent=Vector((1,0,math.sinh((x-L/2)/a))).normalized()
            side=Vector((0,1,0)); up=tangent.cross(side)
            for j in range(3): v.append(Vector((x,0,z(x)))+.0084*(math.cos(j*math.tau/3)*side+math.sin(j*math.tau/3)*up))
        for i in range(n):
            for j in range(3):f.append((i*3+j,i*3+(j+1)%3,(i+1)*3+(j+1)%3,(i+1)*3+j))
        f.extend([(2,1,0),(n*3,n*3+1,n*3+2)])
    else:
        # Up-facing four-segment strip: 8 triangles, no double-sided material.
        for i in range(5):
            x=L*i/4; v.extend([(x,-.009,z(x)),(x,.009,z(x))])
        f=[(i*2,i*2+2,i*2+3,i*2+1) for i in range(4)]
    g.add(v,f,(.13,.077,.035));return g

def marker(far=False):
    g=Geo()
    if far:
        g.root([(0,.007),(.83,.15)],5,ORANGE,True)
        for a in [.3,3.4]:g.leaf((0,0,.83),(.33*math.cos(a),.33*math.sin(a),1.35),.10,GREEN)
    else:
        g.root([(0,.003),(.20,.043),(.46,.103),(.72,.151),(.87,.16),(.94,.063)],8,ORANGE,True)
        for j in range(7):
            a=j*2.399; d=Vector((math.cos(a),math.sin(a),0))
            base=Vector((0,0,.91)); tip=d*(.25+.05*(j%2))+Vector((0,0,1.30+.06*(j%3)))
            g.leaf(base,tip,.05,tuple(c*(.85+.03*j) for c in GREEN))
            side=Vector((-d.y,d.x,0))
            for k,sgn in enumerate([-1,1]):
                mid=base.lerp(tip,.48+.08*k)
                g.leaf(mid,mid+d*.1+side*.14*sgn+Vector((0,0,.14)),.055,GREEN)
    return g

def inst(src,s,name,loc=(0,0,0),angle=0,scale=1):
    ob=bpy.data.objects.new(name,KIT[src].data); s.collection.objects.link(ob)
    ob.location=loc; ob.rotation_euler.z=angle; ob.scale=(scale,)*3
    return ob

def sample_ridge(x,y,k,lod):
    # Intersect exported triangulation, not the analytic high-resolution profile.
    from mathutils.bvhtree import BVHTree
    ob=KIT[f'BUTTE_{k+1}_LOD{lod}']; me=ob.data; me.calc_loop_triangles()
    tree=BVHTree.FromPolygons([v.co for v in me.vertices],[t.vertices for t in me.loop_triangles],all_triangles=True)
    hit=tree.ray_cast(Vector((x,y,1)),Vector((0,0,-1)))[0]
    return hit.z if hit is not None else -.012

def assembly(name,cells,lod,stage=7,fence=True,markers=True):
    s=scene(name); entries=[]; cells=set(map(tuple,cells))
    def place(src,loc,ang=0,scale=1,tag=''):
        ob=inst(src,s,f'{tag}_{len(entries):03d}_LOD{lod}',loc,ang,scale)
        entries.append({'source':src,'position':list(loc),'yaw':ang,'scale':scale,'role':tag})
        return ob
    for ci,(cx,cy) in enumerate(sorted(cells)):
        ox,oy=cx*2.5,cy*2.5
        if lod==2:
            place(f'PARCELLE_STADE_{stage:02}_LOD2',(ox,oy,0),tag='parcelle'); continue
        place(f'SOL_LOD{lod}',(ox+1.25,oy+1.25,-.001),tag='sol')
        for row,ry in enumerate([.43,1.25,2.07]):
            k=(ci+row)%3
            place(f'BUTTE_{k+1}_LOD{lod}',(ox+1.25,oy+ry,.012),tag='butte')
            if lod==0:
                rng=random.Random(800+k)
                for p in range(16):
                    x=-1.11+p*2.22/15; y=rng.uniform(-.025,.025)
                    z=sample_ridge(x,y,k,0)+.012
                    place(f'CAROTTE_STADE_{stage:02}_LOD0',(ox+1.25+x,oy+ry+y,z),rng.uniform(-math.pi,math.pi),rng.uniform(.9,1.05),f'plant_{ci}_{row}_{p}')
            else:place(f'RANG_STADE_{stage:02}_VAR_{k+1}_LOD1',(ox+1.25,oy+ry,.012),tag='rang')
        # Four boards/cell: paired lengths sum 2.18, kept inside each 2.5m cell.
        lengths=[1.52,.66,1.20,.98,.82,1.36]
        for lane,ly in enumerate([.84,1.66]):
            pair=(ci+lane)%3; ids=[pair*2,pair*2+1]; cursor=.10
            for b,idx in enumerate(ids):
                le=lengths[idx]
                place(f'PLANCHE_{idx+1}_LOD{lod}',(ox+cursor+le/2,oy+ly+(.012 if (ci+lane+b)%2 else -.012),.001),(.018 if b else -.025),tag='planche')
                cursor+=le+.065
        if lod==0:
            for j in range(6):
                row=j//2; x=(-.70 if j%2==0 else .62); k=(ci+row)%3; y=.11*(1 if j%2 else -1)
                place('MOTTE_LOD0',(ox+1.25+x,oy+[.43,1.25,2.07][row]+y,.012+sample_ridge(x,y,k,0)),j*.9,tag='motte')
        if markers:
            place('MARQUEUR_LOD0' if lod==0 else 'MARQUEUR_LOD1',(ox+1.25,oy+1.25,.72),-.15,.52,tag='marqueur')
    if fence and lod<2:
        posts=set()
        for cx,cy in sorted(cells):
            for dx,dy,a,b in [(0,-1,(0,0),(2,0)),(1,0,(2,0),(2,2)),(0,1,(2,2),(0,2)),(-1,0,(0,2),(0,0))]:
                if (cx+dx,cy+dy) in cells:continue
                start=(cx*2+a[0],cy*2+a[1]); end=(cx*2+b[0],cy*2+b[1]); mid=((start[0]+end[0])//2,(start[1]+end[1])//2)
                for p,q in [(start,mid),(mid,end)]:
                    posts.add(p); posts.add(q)
                    place(f'CORDE_LOD{lod}',(p[0]*1.25,p[1]*1.25,0),math.atan2(q[1]-p[1],q[0]-p[0]),tag='corde')
        for x,y in sorted(posts):place(f'PIQUET_LOD{lod}',(x*1.25,y*1.25,0),tag='piquet')
    PLACEMENTS[name]=entries
    return s

def camera(s,top=False,center=(2.5,2.5,.15),span=7.4):
    ca=bpy.data.cameras.new('Camera '+s.name); ob=bpy.data.objects.new(ca.name,ca); s.collection.objects.link(ob);s.camera=ob
    target=Vector(center); ob.location=target+Vector((0,0,10) if top else (6,-9,9))
    ob.rotation_euler=(target-ob.location).to_track_quat('-Z','Y').to_euler(); ca.type='ORTHO'; ca.ortho_scale=span
    return ob

def render(s,path,w=900,h=760):
    bpy.context.window.scene=s;s.render.resolution_x=w;s.render.resolution_y=h
    s.render.filepath=str(path); bpy.ops.render.render(write_still=True)

def build():
    scene('kit')
    material('terre','soil-source.png'); material('vegetal'); material('bois','wood-basecolor.png');material('corde')
    for stage in range(1,8):mesh(f'CAROTTE_STADE_{stage:02}_LOD0',plant(stage),'vegetal')
    for lod in [0,1]:
        for k in range(3):mesh(f'BUTTE_{k+1}_LOD{lod}',ridge(k,lod),'terre')
        for i,length in enumerate([1.52,.66,1.20,.98,.82,1.36]):
            g=box(length,.17,.014)
            if lod==1:g=Geo();g.add([(-length/2,-.085,.008),(length/2,-.085,.008),(length/2,.085,.008),(-length/2,.085,.008)],[(0,1,2,3)],(1,1,1))
            mesh(f'PLANCHE_{i+1}_LOD{lod}',g,'bois','wood')
        # Exact V7 post geometry; no simplification.
        g=Geo();g.add([(-.014664,-.013416,0),(.0156,-.013416,0),(.0156,.014352,0),(-.014664,.014352,0),(-.01092,-.011544,.366),(.012168,-.011544,.384),(.012168,.011232,.384),(-.01092,.011232,.366)],[(0,3,2,1),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)],(1,1,1))
        mesh(f'PIQUET_LOD{lod}',g,'bois','post')
        mesh(f'CORDE_LOD{lod}',rope(lod),'corde')
        g=Geo();g.add([(-1.25,-1.25,0),(1.25,-1.25,0),(1.25,1.25,0),(-1.25,1.25,0)],[(0,1,2,3)],(.78,.74,.70))
        mesh(f'SOL_LOD{lod}',g,'terre',shade=False)
    g=Geo();g.add([(0,0,.027),(.0330817662,0,.0108360611),(.0142963845,.017927099,.0087056234),(-.0055541405,.02433428,.00858658),(-.026673274,.01284517,.01251464),(-.029144399,-.0140352,.00846458),(-.007264717,-.0318288,.00627025),(.015375922,-.0192808,.00511998),(0,0,-.008)],[(0,1,2),(8,2,1),(0,2,3),(8,3,2),(0,3,4),(8,4,3),(0,4,5),(8,5,4),(0,5,6),(8,6,5),(0,6,7),(8,7,6),(0,7,1),(8,1,7)],(1,.95,.88))
    mesh('MOTTE_LOD0',g,'terre')
    for stage in range(1,8):
        for k in range(3):
            merged=Geo(); rng=random.Random(800+k)
            for p in range(16):
                x=-1.11+p*2.22/15;y=rng.uniform(-.025,.025);yaw=rng.uniform(-math.pi,math.pi);sc=rng.uniform(.9,1.05)
                g=plant(stage,1);r=Matrix.Rotation(yaw,4,'Z');z=sample_ridge(x,y,k,1)
                merged.v.extend([])
                for face,col in zip(g.f,g.c): merged.add([r@Vector(g.v[i])*sc+Vector((x,y,z)) for i in face],[tuple(range(len(face)))],col)
            mesh(f'RANG_STADE_{stage:02}_VAR_{k+1}_LOD1',merged,'vegetal')
    mesh('MARQUEUR_LOD0',marker(),'vegetal');mesh('MARQUEUR_LOD1',marker(True),'vegetal')
    for lod in [0,1]:
        for name,cells in [('parcel',[(0,0)]),('L',[(0,0),(1,0),(0,1)])]:
            s=assembly(name+f'_LOD{lod}',cells,lod)
            camera(s,center=(1.25,1.25,.15) if name=='parcel' else (2.5,2.5,.15),span=4.2 if name=='parcel' else 7.4)
    counts={n:sum(tris(o) for o in s.objects if o.type=='MESH') for n,s in SCENES.items() if n!='kit'}
    print(json.dumps({'pieces':{n:tris(o) for n,o in KIT.items()},'assemblies':counts}))

def bake():
    for stage in range(1,8):
        s=assembly(f'bake_{stage}',[(0,0)],0,stage,fence=False,markers=False)
        camera(s,top=True,center=(1.25,1.25,0),span=2.5)
        s.render.film_transparent=False
        render(s,OUT/'textures'/f'garden-stage-{stage:02}-256.png',256,256)
    print('Seven top-view LOD0 bakes saved (no fence/marker).')

def export(s,objects,path):
    bpy.context.window.scene=s
    for o in s.objects:o.select_set(False)
    for o in objects:o.hide_set(False);o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_animations=False,export_cameras=False,export_lights=False,export_vertex_color='ACTIVE',export_all_vertex_colors=False)
    for o in objects:o.select_set(False)

def finish():
    # Shared 4x4 atlas: seven 128px cells + one dirt tile. 4px gutters, 120px content.
    tex=next(n for n in MATS['terre'].node_tree.nodes if n.type=='TEX_IMAGE')
    tex.image=bpy.data.images.load(str(OUT/'textures'/'soil-and-lod2-atlas.png'),check_existing=False)
    # Soil objects now sample atlas slot 7, preserving original texture UV repeats.
    for ob in KIT.values():
        if ob.data.materials[0]!=MATS['terre']:continue
        for uv in ob.data.uv_layers.active.data:
            u,v=uv.uv;uv.uv=((3*128+4+min(1,max(0,u))*120)/512,(2*128+4+min(1,max(0,v))*120)/512)
    for stage in range(1,8):
        g=Geo();g.add([(0,0,0),(2.5,0,0),(2.5,2.5,0),(0,2.5,0)],[(0,1,2,3)],(1,1,1))
        ob=mesh(f'PARCELLE_STADE_{stage:02}_LOD2',g,'terre',shade=False)
        idx=stage-1;col=idx%4;row=idx//4
        # Atlas origin is bottom left for UV, top left for PNG.
        for p in ob.data.polygons:
            for li in p.loop_indices:
                co=ob.data.vertices[ob.data.loops[li].vertex_index].co
                ob.data.uv_layers.active.data[li].uv=((col*128+4+co.x/2.5*120)/512,((3-row)*128+4+co.y/2.5*120)/512)
    for name,cells in [('parcel',[(0,0)]),('L',[(0,0),(1,0),(0,1)])]:
        s=assembly(name+'_LOD2',cells,2);camera(s,center=(1.25,1.25,.15) if name=='parcel' else (2.5,2.5,.15),span=4.2 if name=='parcel' else 7.4)
    export(SCENES['kit'],list(KIT.values()),OUT/'assets'/'garden-kit.glb')
    for lod in [0,1]:export(SCENES['kit'],[KIT[f'MARQUEUR_LOD{lod}']],OUT/'assets'/f'harvest-carrot_LOD{lod}.glb')
    for lod in [0,1,2]:
        obs=[ob for n,ob in KIT.items() if n.endswith(f'_LOD{lod}')]
        export(SCENES['kit'],obs,OUT/'assets'/f'garden-kit_LOD{lod}.glb')
        for name in ['parcel','L']:
            s=SCENES[name+f'_LOD{lod}']
            bpy.context.window.scene=s
            bpy.context.view_layer.update()
            # Demo placement transforms baked into vertex data, identity object transforms.
            for ob in s.objects:
                if ob.type=='MESH':
                    me=ob.data.copy();me.transform(ob.matrix_world);ob.data=me;ob.matrix_world=Matrix.Identity(4)
            export(s,[o for o in s.objects if o.type=='MESH'],OUT/'assets'/f'example-{name}_LOD{lod}.glb')
            render(s,OUT/'previews'/f'{name}_LOD{lod}.png')
    # Seven stages in a clean gallery, no extra materials.
    s=scene('seven stages')
    for st in range(1,8):inst(f'CAROTTE_STADE_{st:02}_LOD0',s,f'stage_{st}_LOD0',((st-4)*.23,0,0))
    camera(s,center=(0,0,.04),span=1.8);render(s,OUT/'previews'/'seven-stages.png',1200,360)
    s=scene('marker comparison')
    inst('MARQUEUR_LOD0',s,'marker_near_LOD0',(-.5,0,0));inst('MARQUEUR_LOD1',s,'marker_far_LOD1',(.5,0,0))
    camera(s,center=(0,0,.68),span=2.5);render(s,OUT/'previews'/'markers.png',900,680)
    # Store local source pivots plus placement recipes, all in Blender coordinates.
    (OUT/'reference'/'assembly.json').write_text(json.dumps({'cellSize':2.5,'axes':'Blender XY ground +Z up; glTF (x,z,-y)','placements':PLACEMENTS},indent=2),encoding='utf-8')
    (OUT/'reference'/'mesh-counts.json').write_text(json.dumps({'pieces':{n:tris(o) for n,o in KIT.items()},'assemblies':{n:sum(tris(o) for o in s.objects if o.type=='MESH') for n,s in SCENES.items() if n.startswith(('parcel','L_'))}},indent=2),encoding='utf-8')
    for img in bpy.data.images:
        if img.filepath.startswith(str(OUT)):img.pack()
    bpy.context.window.scene=SCENES['L_LOD0']
    # Write ONLY V8 scenes/dependencies; V7 live scenes are not carried into this source.
    bpy.data.libraries.write(str(OUT/'sources'/'garden-v8.blend'),set(SCENES.values()),fake_user=True,compress=True)
    print('V8 exported, rendered, and saved.')

if __name__=='__main__':
    build()
