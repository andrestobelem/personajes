import {z} from 'zod';
import {canonicalJson} from '../domain/canonical-json.ts';
import {HashSchema} from '../domain/values.ts';
import {SelectableInferenceProfileSchema} from '../domain/inference-profile.ts';
import type {ProductionPreflightHostPort} from './production-preflight.ts';
import {fingerprintInferenceProfile} from './pi-access-check.ts';

export type PreparationConfiguratorAdmissionHost=Pick<ProductionPreflightHostPort,'readPiSdkStatus'|'readPiModelProfile'|'readInferenceAuthenticationStatus'|'readInferenceAccessCheckReceipt'>;
const SdkSchema=z.object({kind:z.literal('ready'),piCodingAgentVersion:z.literal('1.2.0'),piAiVersion:z.literal('1.2.0'),sessionFactoryAvailable:z.literal(true)});
const ProfileSchema=z.object({kind:z.literal('configured'),profile:z.union([SelectableInferenceProfileSchema.options[0].extend({fingerprint:HashSchema}),SelectableInferenceProfileSchema.options[1].extend({fingerprint:HashSchema})])});
const AuthenticationSchema=z.object({kind:z.literal('authenticated'),provider:SelectableInferenceProfileSchema.options[0].shape.provider.or(SelectableInferenceProfileSchema.options[1].shape.provider),method:z.literal('oauth'),accountFingerprint:HashSchema});
const AccessSchema=z.object({kind:z.literal('passed'),provider:AuthenticationSchema.shape.provider,accountFingerprint:HashSchema,profileFingerprint:HashSchema,checkedAt:z.iso.datetime({offset:true}),expiresAt:z.iso.datetime({offset:true})});

/** Read-only admission. An explicit existing access receipt is required; this
 * check never probes a provider, refreshes a token or creates a Pi session. */
export async function requirePreparationConfiguratorAdmission(input:{host:PreparationConfiguratorAdmissionHost;profile:unknown;signal?:AbortSignal;now?:()=>number}){
  const profile=SelectableInferenceProfileSchema.parse(input.profile),fingerprint=HashSchema.parse(fingerprintInferenceProfile(profile));input.signal?.throwIfAborted();
  try{
    const [sdk,model,authentication]=await Promise.all([input.host.readPiSdkStatus(),input.host.readPiModelProfile({provider:profile.provider}),input.host.readInferenceAuthenticationStatus({provider:profile.provider})]);
    input.signal?.throwIfAborted();SdkSchema.parse(sdk);const configured=ProfileSchema.parse(model),auth=AuthenticationSchema.parse(authentication);
    const {fingerprint:actual,...effective}=configured.profile;
    if(actual!==fingerprint||canonicalJson(effective)!==canonicalJson(profile)||auth.provider!==profile.provider)throw new Error('PREPARATION_CONFIGURATOR_PROFILE_UNAVAILABLE');
    const accessResult=AccessSchema.safeParse(await input.host.readInferenceAccessCheckReceipt({provider:profile.provider,accountFingerprint:auth.accountFingerprint,profileFingerprint:fingerprint}));input.signal?.throwIfAborted();
    if(!accessResult.success)throw new Error('PREPARATION_CONFIGURATOR_ACCESS_REQUIRED');
    const access=accessResult.data;
    const now=(input.now??Date.now)();
    if(access.provider!==profile.provider||access.accountFingerprint!==auth.accountFingerprint||access.profileFingerprint!==fingerprint||Date.parse(access.checkedAt)>now||now>=Date.parse(access.expiresAt))throw new Error('PREPARATION_CONFIGURATOR_ACCESS_REQUIRED');
  }catch(error){if(input.signal?.aborted)throw error;
    // Only these fixed public diagnoses cross the boundary; never forward provider errors.
    if(error instanceof Error&&(error.message==='PREPARATION_CONFIGURATOR_ACCESS_REQUIRED'||error.message==='PREPARATION_CONFIGURATOR_PROFILE_UNAVAILABLE'))throw new Error(error.message);
    throw new Error('PREPARATION_CONFIGURATOR_ADMISSION_UNAVAILABLE');}
}
