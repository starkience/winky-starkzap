use starknet::ContractAddress;

#[starknet::interface]
pub trait IWinkyBlink<TContractState> {
    /// Record a blink for the caller
    fn record_blink(ref self: TContractState);

    /// Get total blink count for a user
    fn get_user_blinks(self: @TContractState, user: ContractAddress) -> u64;

    /// Get total blinks across all users (global counter)
    fn get_total_blinks(self: @TContractState) -> u64;

    /// Get contract version
    fn get_version(self: @TContractState) -> felt252;
}

#[starknet::contract]
pub mod WinkyBlink {
    use starknet::ContractAddress;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;

    /// Contract version for deployment tracking
    const VERSION: felt252 = 2;

    #[storage]
    struct Storage {
        /// Total blinks per user (all-time)
        user_blinks: Map<ContractAddress, u64>,
        /// Global total blinks counter
        total_blinks: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Blink: Blink,
    }

    /// Emitted for each blink recorded
    #[derive(Drop, starknet::Event)]
    pub struct Blink {
        #[key]
        pub user: ContractAddress,
        pub timestamp: u64,
        pub user_total: u64,
        pub global_total: u64,
    }

    #[abi(embed_v0)]
    impl WinkyBlinkImpl of super::IWinkyBlink<ContractState> {
        /// Record a blink for the caller
        fn record_blink(ref self: ContractState) {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();

            // Update user total (+1)
            let current_user_total = self.user_blinks.entry(caller).read();
            let new_user_total = current_user_total + 1;
            self.user_blinks.entry(caller).write(new_user_total);

            // Update global total (+1)
            let current_global = self.total_blinks.read();
            let new_global = current_global + 1;
            self.total_blinks.write(new_global);

            // Emit blink event
            self
                .emit(
                    Blink {
                        user: caller,
                        timestamp,
                        user_total: new_user_total,
                        global_total: new_global,
                    },
                );
        }

        fn get_user_blinks(self: @ContractState, user: ContractAddress) -> u64 {
            self.user_blinks.entry(user).read()
        }

        fn get_total_blinks(self: @ContractState) -> u64 {
            self.total_blinks.read()
        }

        fn get_version(self: @ContractState) -> felt252 {
            VERSION
        }
    }
}
