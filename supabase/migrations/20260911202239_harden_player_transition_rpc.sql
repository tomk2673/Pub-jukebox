alter function public.jukebox_transition_rpc(text, jsonb) security invoker;
revoke execute on function public.jukebox_transition_rpc(text, jsonb) from authenticated;
