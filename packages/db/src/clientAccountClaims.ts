import { resolveClinicId } from "./clinics";
import { getSql } from "./connection";

type ClaimMatchRow = {
  client_id: string;
  client_name: string;
  email: string | null;
  phone: string;
  pet_id: string;
  pet_name: string;
};

type ClaimRow = {
  id: string;
  clinic_id: string;
  matched_client_id: string | null;
  matched_pet_id: string | null;
  code_hash: string | null;
  code_salt: string | null;
  status: string;
  attempts: number;
  expires_at: string | null;
};

export async function beginClientAccountClaim(input: {
  clinicId?: string | null;
  requesterHash: string;
  contactKind: "email" | "phone";
  contactValue: string;
  petName: string;
  codeHash: string;
  codeSalt: string;
  destinationHint: string;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const recentClaims = await sql<Array<{ id: string; status: string }>>`
    select id, status
    from client_account_claims
    where clinic_id = ${clinicId}
      and requester_hash = ${input.requesterHash}
      and created_at >= now() - interval '1 hour'
    order by created_at desc
    limit 5
  `;
  if (recentClaims.length >= 5) {
    return {
      claimId: recentClaims[0].id,
      matched: false,
      destinationHint: null,
      match: null,
      rateLimited: true
    };
  }

  const contact = input.contactValue.trim().toLowerCase();
  const phoneDigits = input.contactValue.replace(/\D/g, "").slice(-10);
  const matches = await sql<ClaimMatchRow[]>`
    select
      client.id as client_id,
      client.full_name as client_name,
      client.email,
      client.phone,
      pet.id as pet_id,
      pet.name as pet_name
    from mock_clients client
    join mock_pets pet
      on pet.clinic_id = client.clinic_id
      and pet.client_id = client.id
    where client.clinic_id = ${clinicId}
      and lower(pet.name) = lower(${input.petName.trim()})
      and (
        (
          ${input.contactKind} = 'email'
          and lower(coalesce(client.email, '')) = ${contact}
        )
        or (
          ${input.contactKind} = 'phone'
          and right(
            regexp_replace(client.phone, '[^0-9]', '', 'g'),
            10
          ) = ${phoneDigits}
        )
      )
    limit 2
  `;
  const match = matches.length === 1 ? matches[0] : null;
  const pendingReview = recentClaims.find(
    (claim) => claim.status === "pending_staff_review"
  );
  if (!match && pendingReview) {
    return {
      claimId: pendingReview.id,
      matched: false,
      destinationHint: null,
      match: null,
      rateLimited: true
    };
  }

  const status = match ? "pending" : "pending_staff_review";
  const rows = await sql<{ id: string }[]>`
    insert into client_account_claims (
      clinic_id,
      requester_hash,
      matched_client_id,
      matched_pet_id,
      delivery_channel,
      destination_hint,
      code_hash,
      code_salt,
      status,
      expires_at
    ) values (
      ${clinicId},
      ${input.requesterHash},
      ${match?.client_id ?? null},
      ${match?.pet_id ?? null},
      ${match ? input.contactKind : null},
      ${match ? input.destinationHint : null},
      ${match ? input.codeHash : null},
      ${match ? input.codeSalt : null},
      ${status},
      ${match ? new Date(Date.now() + 10 * 60_000).toISOString() : null}
    )
    returning id
  `;
  return {
    claimId: rows[0].id,
    matched: Boolean(match),
    destinationHint: match ? input.destinationHint : null,
    match,
    rateLimited: false
  };
}

export async function getClientAccountClaimForVerification(input: {
  clinicId?: string | null;
  claimId: string;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const rows = await sql<ClaimRow[]>`
    select
      id,
      clinic_id,
      matched_client_id,
      matched_pet_id,
      code_hash,
      code_salt,
      status,
      attempts,
      expires_at
    from client_account_claims
    where id = ${input.claimId}
      and clinic_id = ${clinicId}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function failClientAccountClaim(input: {
  clinicId?: string | null;
  claimId: string;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  await sql`
    update client_account_claims
    set attempts = attempts + 1,
      status = case when attempts + 1 >= 5 then 'locked' else status end,
      updated_at = now()
    where id = ${input.claimId}
      and clinic_id = ${clinicId}
  `;
}

export async function deferClientAccountClaim(input: {
  clinicId?: string | null;
  claimId: string;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  await sql`
    update client_account_claims
    set status = 'pending_staff_review',
      code_hash = null,
      code_salt = null,
      expires_at = null,
      updated_at = now()
    where id = ${input.claimId}
      and clinic_id = ${clinicId}
      and status = 'pending'
  `;
}

export async function completeClientAccountClaim(input: {
  clinicId?: string | null;
  claimId: string;
  clientId: string;
  petId: string;
  tokenHash: string;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  let completed = false;
  await sql.begin(async (transaction) => {
    const claims = await transaction<{ id: string }[]>`
      update client_account_claims
      set status = 'verified',
        verified_at = now(),
        updated_at = now()
      where id = ${input.claimId}
        and clinic_id = ${clinicId}
        and status = 'pending'
        and attempts < 5
        and expires_at > now()
      returning id
    `;
    if (!claims[0]) return;
    await transaction`
      insert into client_portal_access_grants (
        clinic_id,
        client_id,
        pet_id,
        token_hash,
        expires_at
      )
      values (
        ${clinicId},
        ${input.clientId},
        ${input.petId},
        ${input.tokenHash},
        now() + interval '90 days'
      )
    `;
    completed = true;
  });
  return completed;
}
