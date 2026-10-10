import {Type,type Static} from '@sinclair/typebox';
// Immutable RC1 relief, sampled every half cell. Heights use canonical cell units.
export const Rc1GroundSchema=Type.Object({
 stride:Type.Integer({minimum:1}),heights:Type.Array(Type.Number()),water:Type.Array(Type.Number()),
 terraces:Type.Array(Type.Object({cellX:Type.Integer(),cellY:Type.Integer(),height:Type.Number()})),
});
export type Rc1Ground=Static<typeof Rc1GroundSchema>;
export const Rc1FeatureGeometrySchema=Type.Object({
 trees:Type.Array(Type.Object({x:Type.Number(),y:Type.Number(),elevation:Type.Number(),size:Type.Number(),crown:Type.Number()})),
 rocks:Type.Array(Type.Object({x:Type.Number(),y:Type.Number(),elevation:Type.Number(),width:Type.Number(),depth:Type.Number(),height:Type.Number(),rotation:Type.Number()})),
});
export type Rc1FeatureGeometry=Static<typeof Rc1FeatureGeometrySchema>;

export const RC1_WORLD = Object.freeze({widthCells:512,heightCells:256,chunkSize:32,altitudeCellRatio:.25});
