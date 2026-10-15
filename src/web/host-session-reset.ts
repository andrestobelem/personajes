/** Browser authority changed; existing opt-ins must be requested explicitly again. */
export const HOST_SESSION_RESET_EVENT='personajes:host-session-reset';
export function subscribeToHostSessionReset(onReset:()=>void,target:EventTarget=window):()=>void {
  const listener=()=>onReset();
  target.addEventListener(HOST_SESSION_RESET_EVENT,listener);
  return ()=>target.removeEventListener(HOST_SESSION_RESET_EVENT,listener);
}
