use starknet::ContractAddress;

#[starknet::interface]
pub trait IERC20<TContractState> {
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
}

#[starknet::interface]
pub trait IBlinkEscrow<TContractState> {
    fn create_duel(ref self: TContractState, stake: u256) -> u64;
    fn join_duel(ref self: TContractState, duel_id: u64);
    fn resolve_duel(ref self: TContractState, duel_id: u64, winner: ContractAddress, is_draw: bool);
    fn cancel_duel(ref self: TContractState, duel_id: u64);
    fn withdraw_surplus(ref self: TContractState);
    fn get_duel(self: @TContractState, duel_id: u64) -> (ContractAddress, ContractAddress, u256, u8);
    fn get_duel_count(self: @TContractState) -> u64;
    fn get_fee_bps(self: @TContractState) -> u16;
    fn set_fee_bps(ref self: TContractState, fee_bps: u16);
    fn get_token_address(self: @TContractState) -> ContractAddress;
}

#[starknet::contract]
pub mod BlinkEscrow {
    use openzeppelin_access::ownable::OwnableComponent;
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_caller_address, get_contract_address};
    use core::num::traits::Zero;
    use super::{IERC20Dispatcher, IERC20DispatcherTrait};

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableMixinImpl = OwnableComponent::OwnableMixinImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    const STATUS_CREATED: u8 = 0;
    const STATUS_JOINED: u8 = 1;
    const STATUS_RESOLVED: u8 = 2;
    const STATUS_DRAW: u8 = 3;
    const STATUS_CANCELLED: u8 = 4;

    const MAX_FEE_BPS: u16 = 1000; // 10% max fee

    #[storage]
    pub struct Storage {
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
        pub token_address: ContractAddress,
        pub fee_bps: u16,
        pub next_duel_id: u64,
        pub duel_player1: Map<u64, ContractAddress>,
        pub duel_player2: Map<u64, ContractAddress>,
        pub duel_stake: Map<u64, u256>,
        pub duel_status: Map<u64, u8>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        DuelCreated: DuelCreated,
        DuelJoined: DuelJoined,
        DuelResolved: DuelResolved,
        DuelCancelled: DuelCancelled,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DuelCreated {
        #[key]
        pub duel_id: u64,
        #[key]
        pub player1: ContractAddress,
        pub stake: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DuelJoined {
        #[key]
        pub duel_id: u64,
        #[key]
        pub player2: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DuelResolved {
        #[key]
        pub duel_id: u64,
        pub winner: ContractAddress,
        pub payout: u256,
        pub is_draw: bool,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DuelCancelled {
        #[key]
        pub duel_id: u64,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        token: ContractAddress,
        fee_bps: u16,
    ) {
        assert!(!owner.is_zero(), "Owner cannot be zero");
        assert!(!token.is_zero(), "Token cannot be zero");
        assert!(fee_bps <= MAX_FEE_BPS, "Fee too high");
        self.ownable.initializer(owner);
        self.token_address.write(token);
        self.fee_bps.write(fee_bps);
        self.next_duel_id.write(0);
    }

    #[abi(embed_v0)]
    impl BlinkEscrowImpl of super::IBlinkEscrow<ContractState> {
        fn create_duel(ref self: ContractState, stake: u256) -> u64 {
            assert!(stake > 0, "Stake must be > 0");

            let caller = get_caller_address();
            let this = get_contract_address();
            let token = IERC20Dispatcher { contract_address: self.token_address.read() };

            let success = token.transfer_from(caller, this, stake);
            assert!(success, "Deposit failed");

            let duel_id = self.next_duel_id.read();
            self.next_duel_id.write(duel_id + 1);

            self.duel_player1.entry(duel_id).write(caller);
            self.duel_player2.entry(duel_id).write(Zero::zero());
            self.duel_stake.entry(duel_id).write(stake);
            self.duel_status.entry(duel_id).write(STATUS_CREATED);

            self.emit(DuelCreated { duel_id, player1: caller, stake });

            duel_id
        }

        fn join_duel(ref self: ContractState, duel_id: u64) {
            let status = self.duel_status.entry(duel_id).read();
            assert!(status == STATUS_CREATED, "Duel not open");

            let caller = get_caller_address();
            let player1 = self.duel_player1.entry(duel_id).read();
            assert!(caller != player1, "Cannot join own duel");

            let this = get_contract_address();
            let stake = self.duel_stake.entry(duel_id).read();
            let token = IERC20Dispatcher { contract_address: self.token_address.read() };

            let success = token.transfer_from(caller, this, stake);
            assert!(success, "Deposit failed");

            self.duel_player2.entry(duel_id).write(caller);
            self.duel_status.entry(duel_id).write(STATUS_JOINED);

            self.emit(DuelJoined { duel_id, player2: caller });
        }

        fn resolve_duel(
            ref self: ContractState,
            duel_id: u64,
            winner: ContractAddress,
            is_draw: bool,
        ) {
            self.ownable.assert_only_owner();

            let status = self.duel_status.entry(duel_id).read();
            assert!(status == STATUS_JOINED, "Duel not active");

            let player1 = self.duel_player1.entry(duel_id).read();
            let player2 = self.duel_player2.entry(duel_id).read();
            let stake = self.duel_stake.entry(duel_id).read();
            let token = IERC20Dispatcher { contract_address: self.token_address.read() };

            if is_draw {
                self.duel_status.entry(duel_id).write(STATUS_DRAW);

                let s1 = token.transfer(player1, stake);
                assert!(s1, "Refund p1 failed");
                let s2 = token.transfer(player2, stake);
                assert!(s2, "Refund p2 failed");

                self
                    .emit(
                        DuelResolved {
                            duel_id, winner: Zero::zero(), payout: stake, is_draw: true,
                        },
                    );
            } else {
                assert!(winner == player1 || winner == player2, "Invalid winner");

                self.duel_status.entry(duel_id).write(STATUS_RESOLVED);

                let total_pot = stake * 2;
                let fee_bps: u256 = self.fee_bps.read().into();
                let fee = (total_pot * fee_bps) / 10000;
                let payout = total_pot - fee;

                let sw = token.transfer(winner, payout);
                assert!(sw, "Winner payout failed");

                if fee > 0 {
                    let owner = self.ownable.owner();
                    let sf = token.transfer(owner, fee);
                    assert!(sf, "Fee transfer failed");
                }

                self.emit(DuelResolved { duel_id, winner, payout, is_draw: false });
            }
        }

        fn cancel_duel(ref self: ContractState, duel_id: u64) {
            let status = self.duel_status.entry(duel_id).read();
            assert!(status == STATUS_CREATED, "Can only cancel open duels");

            let caller = get_caller_address();
            let player1 = self.duel_player1.entry(duel_id).read();
            let is_owner = caller == self.ownable.owner();
            assert!(caller == player1 || is_owner, "Not authorized");

            let stake = self.duel_stake.entry(duel_id).read();
            let token = IERC20Dispatcher { contract_address: self.token_address.read() };

            self.duel_status.entry(duel_id).write(STATUS_CANCELLED);

            let success = token.transfer(player1, stake);
            assert!(success, "Refund failed");

            self.emit(DuelCancelled { duel_id });
        }

        fn withdraw_surplus(ref self: ContractState) {
            self.ownable.assert_only_owner();

            let token = IERC20Dispatcher { contract_address: self.token_address.read() };
            let this = get_contract_address();
            let balance = token.balance_of(this);

            let mut locked: u256 = 0;
            let limit = self.next_duel_id.read();
            for i in 0..limit {
                let status = self.duel_status.entry(i).read();
                if status == STATUS_CREATED {
                    locked += self.duel_stake.entry(i).read();
                } else if status == STATUS_JOINED {
                    locked += self.duel_stake.entry(i).read() * 2;
                };
            };

            assert!(balance > locked, "No surplus to withdraw");
            let surplus = balance - locked;
            let owner = self.ownable.owner();
            let success = token.transfer(owner, surplus);
            assert!(success, "Surplus transfer failed");
        }

        fn get_duel(
            self: @ContractState, duel_id: u64,
        ) -> (ContractAddress, ContractAddress, u256, u8) {
            let player1 = self.duel_player1.entry(duel_id).read();
            let player2 = self.duel_player2.entry(duel_id).read();
            let stake = self.duel_stake.entry(duel_id).read();
            let status = self.duel_status.entry(duel_id).read();
            (player1, player2, stake, status)
        }

        fn get_duel_count(self: @ContractState) -> u64 {
            self.next_duel_id.read()
        }

        fn get_fee_bps(self: @ContractState) -> u16 {
            self.fee_bps.read()
        }

        fn set_fee_bps(ref self: ContractState, fee_bps: u16) {
            self.ownable.assert_only_owner();
            assert!(fee_bps <= MAX_FEE_BPS, "Fee too high");
            self.fee_bps.write(fee_bps);
        }

        fn get_token_address(self: @ContractState) -> ContractAddress {
            self.token_address.read()
        }
    }
}
