// verify-wallet — proves the player owns the wallet they submitted.
//
// Flow:
//   1. Browser calls create_wallet_challenge(address) RPC → gets { challenge_id, message }
//   2. Wallet signs `message` (free, no transaction)
//   3. Browser POSTs { challenge_id, signature } here with its Supabase JWT
//   4. We check the signature against the challenge's address, then call
//      link_verified_wallet() with the service role (the only role allowed to).
//
// Smart-contract wallets (ERC-1271) are supported too: viem's publicClient
// verifyMessage falls back to an on-chain isValidSignature call.
//
// Deploy:  supabase functions deploy verify-wallet
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are
//          provided automatically. Optionally set ROBINHOOD_RPC_URL.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { createPublicClient, defineChain, http, isAddress, isHex } from "npm:viem@2";

const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [Deno.env.get("ROBINHOOD_RPC_URL") ?? "https://rpc.mainnet.chain.robinhood.com"] } },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "POST only" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return reply(401, { error: "Sign in first" });

  // Who is calling — from their JWT, never from the body.
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: userErr } = await asUser.auth.getUser(jwt);
  if (userErr || !userData.user) return reply(401, { error: "Session expired — sign in again" });

  let body: { challenge_id?: string; signature?: string };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "Bad request" });
  }
  const { challenge_id, signature } = body;
  if (!challenge_id || !signature || !isHex(signature)) return reply(400, { error: "Missing challenge or signature" });

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: ch, error: chErr } = await admin
    .from("wallet_challenges")
    .select("id, user_id, address, message, expires_at, used_at")
    .eq("id", challenge_id)
    .maybeSingle();

  if (chErr || !ch) return reply(404, { error: "Challenge not found — try again" });
  if (ch.user_id !== userData.user.id) return reply(403, { error: "This challenge belongs to another account" });
  if (ch.used_at) return reply(409, { error: "Challenge already used — start again" });
  if (new Date(ch.expires_at).getTime() < Date.now()) return reply(410, { error: "Challenge expired — start again" });
  if (!isAddress(ch.address)) return reply(400, { error: "Invalid address on challenge" });

  let valid = false;
  try {
    const client = createPublicClient({ chain: robinhoodChain, transport: http() });
    valid = await client.verifyMessage({
      address: ch.address as `0x${string}`,
      message: ch.message,
      signature: signature as `0x${string}`,
    });
  } catch (e) {
    console.error("verifyMessage failed", e);
    valid = false;
  }
  if (!valid) return reply(400, { error: "Signature doesn't match that wallet" });

  const { data, error } = await admin.rpc("link_verified_wallet", { challenge: challenge_id });
  if (error) return reply(400, { error: error.message });

  return reply(200, { ok: true, address: (data as { address: string }).address });
});
