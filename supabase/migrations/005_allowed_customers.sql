-- Add allowed_customers to profiles so admins can control which customers each user can view
alter table profiles add column if not exists allowed_customers text[] not null default '{}';

-- Empty array = no restriction (admin sees all anyway)
-- Non-empty array = user can only see runs for those customers
