INSERT INTO `mu_user` (
  `email`, 
  `username`, 
  `password`, 
  `status`, 
  `roles`, 
  `ticket`, 
  `created`, 
  `updated`
) VALUES (
  'admin@example.com',
  'admin',
  '0192023a7bbd73250516f069df18b500',
  1,
  'admin',
  '000000',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
