import { Box, Tabs, Tab, Skeleton } from '@mui/material';
import {
  CloudQueue as CloudIcon,
  SupervisedUserCircle as UserIcon,
  Business as BusinessIcon,
  Apps as AllIcon
} from '@mui/icons-material';
import { useAccount } from '@/contexts/AccountContext';

export default function AccountTabs() {
  const { accounts, currentAccountId, switchAccount, isLoading } = useAccount();

  const handleChange = (_event: React.SyntheticEvent, newValue: number | 'all') => {
    switchAccount(newValue);
  };

  if (isLoading) {
    return (
      <Box sx={{ mb: 3 }}>
        <Skeleton variant="rectangular" height={48} sx={{ borderRadius: 1 }} />
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', mb: 3, borderBottom: 1, borderColor: 'divider' }}>
      <Tabs
        value={currentAccountId || 'all'}
        onChange={handleChange}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        aria-label="account tabs"
        sx={{
          '& .MuiTab-root': {
            minHeight: 48,
            textTransform: 'none',
            fontWeight: 600,
          },
        }}
      >
        <Tab
          value="all"
          label="全部账户"
          icon={<AllIcon fontSize="small" />}
          iconPosition="start"
        />

        {accounts.map((account) => (
          <Tab
            key={account.id}
            value={account.id}
            label={account.name}
            icon={account.accountId ? <BusinessIcon fontSize="small" /> : <UserIcon fontSize="small" />}
            iconPosition="start"
          />
        ))}
      </Tabs>
    </Box>
  );
}
