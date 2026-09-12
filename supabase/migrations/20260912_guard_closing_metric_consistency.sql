-- Protege somas e quantidades salvas nos fechamentos.
-- Totais monetários ficam com 2 casas e são derivados dos detalhamentos.

create or replace function public.xb_guard_closing_details()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  payments jsonb;
  couriers jsonb;
  total_value numeric := 0;
  total_count integer := 0;
  total_fees numeric := 0;
  cancelled_count integer := 0;
  cancelled_fees numeric := 0;
begin
  if new.details_v2 is null or jsonb_typeof(new.details_v2) <> 'object' then
    return new;
  end if;

  if jsonb_typeof(new.details_v2->'payments') = 'array' then
    select coalesce(jsonb_agg(
      case when jsonb_typeof(item->'value') = 'number'
        then jsonb_set(item, '{value}', to_jsonb(round((item->>'value')::numeric, 2)), true)
        else item end
    ), '[]'::jsonb)
    into payments
    from jsonb_array_elements(new.details_v2->'payments') item;

    new.details_v2 := jsonb_set(new.details_v2, '{payments}', payments, true);
    select coalesce(sum(round((item->>'value')::numeric, 2)), 0),
           coalesce(sum(greatest(0, (item->>'count')::integer)), 0)
      into total_value, total_count
    from jsonb_array_elements(payments) item;

    new.details_v2 := jsonb_set(new.details_v2, '{totalOrderValue}', to_jsonb(round(total_value, 2)), true);
    new.details_v2 := jsonb_set(new.details_v2, '{totalDeliveries}', to_jsonb(total_count), true);
  elsif new.details_v2 ? 'totalOrderValue' then
    new.details_v2 := jsonb_set(new.details_v2, '{totalOrderValue}', to_jsonb(round(coalesce((new.details_v2->>'totalOrderValue')::numeric, 0), 2)), true);
  end if;

  if jsonb_typeof(new.details_v2->'couriers') = 'array' then
    select coalesce(jsonb_agg(
      jsonb_set(
        jsonb_set(item, '{fees}', to_jsonb(round(coalesce((item->>'fees')::numeric, 0), 2)), true),
        '{cancelledFees}', to_jsonb(round(coalesce((item->>'cancelledFees')::numeric, 0), 2)), true
      )
    ), '[]'::jsonb)
    into couriers
    from jsonb_array_elements(new.details_v2->'couriers') item;

    new.details_v2 := jsonb_set(new.details_v2, '{couriers}', couriers, true);
    select coalesce(sum(round((item->>'fees')::numeric, 2)), 0),
           coalesce(sum(greatest(0, (item->>'cancelled')::integer)), 0),
           coalesce(sum(round((item->>'cancelledFees')::numeric, 2)), 0)
      into total_fees, cancelled_count, cancelled_fees
    from jsonb_array_elements(couriers) item;

    new.details_v2 := jsonb_set(new.details_v2, '{totalFees}', to_jsonb(round(total_fees, 2)), true);
    new.details_v2 := jsonb_set(new.details_v2, '{cancelledDeliveries}', to_jsonb(cancelled_count), true);
    new.details_v2 := jsonb_set(new.details_v2, '{cancelledFees}', to_jsonb(round(cancelled_fees, 2)), true);
  end if;

  if new.details_v2 ? 'pending' then
    new.details_v2 := jsonb_set(new.details_v2, '{pending}', to_jsonb(greatest(0, floor(coalesce((new.details_v2->>'pending')::numeric, 0))::integer)), true);
  end if;

  return new;
end;
$$;

drop trigger if exists daily_closings_guard_details on public.daily_closings;
create trigger daily_closings_guard_details
before insert or update of details_v2 on public.daily_closings
for each row execute function public.xb_guard_closing_details();

update public.daily_closings
set details_v2 = details_v2
where details_v2 is not null;
