// Authentication logic with bypass for active testing
export const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Please provide email and password.'
    });
  }

  // Bypass for now (as requested by user)
  console.log(`Bypass auth request for email: ${email}`);
  
  // Return standard mock successful login response
  return res.status(200).json({
    success: true,
    token: 'simulated-jwt-token-bypass-key',
    user: {
      email: email,
      name: email.split('@')[0],
      role: 'admin'
    }
  });
};
