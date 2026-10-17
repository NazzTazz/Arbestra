import {Type, type Static} from '@sinclair/typebox';

const id=Type.String({format:'uuid'}), finite=(minimum:number,maximum:number)=>Type.Number({minimum,maximum});
const vector=Type.Tuple([finite(-10000,10000),finite(-10000,10000),finite(-10000,10000)]);
export const ObservationPoseSchema=Type.Union([
 Type.Object({mode:Type.Union([Type.Literal('village'),Type.Literal('region')]),cellX:finite(0,1e6),cellY:finite(0,1e6),altitude:finite(-10000,10000),alpha:finite(-Math.PI*2,Math.PI*2),beta:finite(.05,.95),radius:finite(3.2,272),fov:finite(.1,2)}, {additionalProperties:false}),
 Type.Object({mode:Type.Literal('world'),eye:vector,target:vector,up:vector,fov:finite(.1,2)},{additionalProperties:false}),
 Type.Object({mode:Type.Union([Type.Literal('inhabitant'),Type.Literal('transition')])},{additionalProperties:false}),
]);
export type ObservationPose=Static<typeof ObservationPoseSchema>;
export const ObservationPublicationSchema=Type.Object({version:Type.Literal(1),sourceId:id,poseSequence:Type.Integer({minimum:0,maximum:Number.MAX_SAFE_INTEGER}),visible:Type.Boolean(),pose:Type.Optional(ObservationPoseSchema)},{additionalProperties:false});
export type ObservationPublication=Static<typeof ObservationPublicationSchema>;
const date=Type.String({format:'date-time'}),sequence=Type.Integer({minimum:0,maximum:Number.MAX_SAFE_INTEGER}),key=Type.String({maxLength:128});
export const ObservationSourceSchema=Type.Object({id,poseSequence:sequence,visible:Type.Boolean(),pose:Type.Union([ObservationPoseSchema,Type.Null()]),lastPoseChangedAt:Type.Union([date,Type.Null()]),lastSourceSeenAt:date,fresh:Type.Boolean()},{additionalProperties:false});
export type ObservationSource=Static<typeof ObservationSourceSchema>;
export const ObservationLeaseSchema=Type.Object({id,instanceId:id,worldId:id,villageId:id,accountId:id,worldSlug:Type.String({maxLength:64}),villageName:Type.String({maxLength:160}),createdAt:date,expiresAt:date},{additionalProperties:false});
export type ObservationLease=Static<typeof ObservationLeaseSchema>;
export const ObservationActionSchema=Type.Object({id,requestId:Type.String({maxLength:64}),commandId:Type.Optional(id),worldId:id,villageId:id,accountId:id,at:date,kind:Type.String({maxLength:100}),
 target:Type.Optional(Type.Object({cellX:finite(0,1e6),cellY:finite(0,1e6)},{additionalProperties:false})),
 businessOutcome:Type.Union([Type.Literal('unknown'),Type.Literal('pending'),Type.Literal('accepted'),Type.Literal('partial'),Type.Literal('rejected')]),
 httpOutcome:Type.Union([Type.Literal('pending'),Type.Literal('finished'),Type.Literal('interrupted')]),statusCode:Type.Optional(Type.Integer({minimum:100,maximum:599})),code:Type.Optional(Type.String({maxLength:64})),
 activityId:Type.Optional(id),activityStatus:Type.Optional(Type.String({maxLength:32})),minimumRevision:Type.Optional(sequence),accepted:Type.Optional(Type.Array(key,{maxItems:228})),refused:Type.Optional(Type.Array(Type.Object({key,reason:Type.String({maxLength:256})},{additionalProperties:false}),{maxItems:228}))
},{additionalProperties:false});
export type ObservationAction=Static<typeof ObservationActionSchema>;
export const ObservationStatusSchema=Type.Object({lease:ObservationLeaseSchema,sources:Type.Array(ObservationSourceSchema,{maxItems:4}),actions:Type.Array(ObservationActionSchema,{maxItems:500}),sequence,coverageStartedAt:date,truncated:Type.Boolean(),degraded:Type.Boolean(),oldestSequence:sequence},{additionalProperties:false});
export type ObservationStatus=Static<typeof ObservationStatusSchema>;
export const ObservationLaunchSchema=Type.Object({url:Type.String({format:'uri',maxLength:2048}),expiresAt:date},{additionalProperties:false});
export type ObservationLaunch=Static<typeof ObservationLaunchSchema>;
